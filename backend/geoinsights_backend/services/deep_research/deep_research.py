"""Main implementation for the Deep Research agent without LangChain dependencies."""

import asyncio
import json
import os
import logging
from typing import Dict, List, Any
from pydantic import BaseModel
from geoinsights_backend.services.llm import get_structured_llm_response, get_llm_response_with_tools
from geoinsights_backend.services.retrieval import retrieve
from geoinsights_backend.services.deep_research.utils import (
    get_today_str,
    get_buffer_string,
    filter_messages,
    remove_up_to_last_ai_message,
    get_notes_from_tool_calls,
    is_token_limit_exceeded,
    get_model_token_limit,
    get_all_tools,
    think_tool as think_tool_function,
)
from geoinsights_backend.services.deep_research.prompts import (
    clarify_with_user_instructions,
    compress_research_simple_human_message,
    compress_research_system_prompt,
    final_report_generation_prompt,
    lead_researcher_prompt,
    research_system_prompt,
    transform_messages_into_research_topic_prompt,
)
from geoinsights_backend.services.e2b import quantitative_analysis
from geoinsights_backend.services import initialize

logger = logging.getLogger(__name__)

MAX_TOKENS_COMPRESSION = int(os.environ.get("MAX_TOKENS_COMPRESSION", "1000"))
MAX_TOKENS_FINAL_REPORT = int(os.environ.get("MAX_TOKENS_FINAL_REPORT", "1500"))
MAX_CONCURRENT_RESEARCH_UNITS = int(os.environ.get("MAX_CONCURRENT_RESEARCH_UNITS", "5"))
MAX_RESEARCHER_ITERATIONS = int(os.environ.get("MAX_RESEARCHER_ITERATIONS", "5"))

async def clarify_with_user(messages: List[Dict[str, Any]]) -> tuple:
    """Analyze user messages and ask clarifying questions if the research scope is unclear.
    
    Args:
        messages: List of message dicts with 'role' and 'content'
        
    Returns:
        tuple: (response_text, next_step) where next_step is "END" or "write_research_brief"
    """
    class ClarifyWithUser(BaseModel):
        need_clarification: bool
        question: str
        verification: str

    system_prompt = clarify_with_user_instructions.format(messages=get_buffer_string(messages), date=get_today_str())
    messages_with_system = messages[:-1] + [{"role": "system", "content": system_prompt}] + messages[-1:]

    response = get_structured_llm_response(ClarifyWithUser, messages_with_system)
    
    if response.need_clarification:
        return response.question, "END"
    else:
        return response.verification, "write_research_brief"


async def write_research_brief(messages: List[Dict[str, Any]], dataset: str) -> tuple:
    """Transform user messages into a structured research brief and initialize supervisor.
    
    Args:
        messages: List of message dicts
        dataset: The dataset to research
        
    Returns:
        tuple: (research_question, supervisor_system_prompt, "research_supervisor")
    """
    class TransformMessagesIntoResearchTopic(BaseModel):
        research_question: str
    
    specific_info_dict = initialize.DATASETS[dataset]['specific_info_dict']
    system_prompt = transform_messages_into_research_topic_prompt.format(messages=get_buffer_string(messages), date=get_today_str(), dataset_context_quantitative=specific_info_dict['dataset_context_quantitative'], topic=specific_info_dict['topic'])
    messages_with_system = messages[:-1] + [{"role": "system", "content": system_prompt}] + messages[-1:]

    response = get_structured_llm_response(TransformMessagesIntoResearchTopic, messages_with_system)
    
    return response.research_question, "research_supervisor"


def get_supervisor_tools() -> List[Dict[str, Any]]:
    """Get tools available to the supervisor."""
    return [
        {
            "type": "function",
            "function": {
                "name": "ConductResearch",
                "description": "Call this tool to conduct research on a specific topic.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "research_topic": {
                            "type": "string",
                            "description": "The topic to research. Should be a single topic, and should be described in high detail (at least a paragraph)."
                        }
                    },
                    "required": ["research_topic"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "ResearchComplete",
                "description": "Call this tool to indicate that the research is complete."
            }
        },
        {
            "type": "function",
            "function": {
                "name": "think_tool",
                "description": """Tool for strategic reflection on research progress and decision-making.

Use this tool after each search to analyze results and plan next steps systematically.
This creates a deliberate pause in the research workflow for quality decision-making.""",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reflection": {
                            "type": "string",
                            "description": "Your detailed reflection on research progress, findings, gaps, and next steps"
                        }
                    },
                    "required": ["reflection"]
                }
            }
        }
    ]


async def supervisor(supervisor_messages: List[Dict[str, Any]],research_brief: str, dataset: str) -> Dict[str, Any]:
    """Lead research supervisor that plans research strategy and delegates to researchers.
    
    Args:
        supervisor_messages: List of message dicts for supervisor conversation
        research_brief: The research question/brief
        dataset: The dataset to research
        
    Returns:
        Dict with 'response' (message dict) and 'next_step' ('supervisor_tools')
    """
    tools = get_supervisor_tools()
    
    # Prepare messages with system prompt
    system_prompt = lead_researcher_prompt.format(max_researcher_iterations=MAX_RESEARCHER_ITERATIONS, max_concurrent_research_units=MAX_CONCURRENT_RESEARCH_UNITS, date=get_today_str())
    messages = [{"role": "system", "content": system_prompt}] + supervisor_messages
    
    messages.append({"role": "user", "content": f"Research question: {research_brief}"})

    response = await get_llm_response_with_tools(
        messages=messages,
        tools=tools
    )
    
    return {
        "response": response,
        "next_step": "supervisor_tools"
    }


async def supervisor_tools(
    supervisor_messages: List[Dict[str, Any]],
    research_brief: str,
    research_iterations: int,
    dataset: str,
    progress_callback=None,
) -> Dict[str, Any]:
    """Execute tools called by the supervisor, including research delegation and strategic thinking.
    
    Args:
        supervisor_messages: List of message dicts including the latest assistant response
        research_brief: The research question/brief
        research_iterations: Current iteration count
        dataset: The dataset to research
        progress_callback: Optional callback for progress updates
        
    Returns:
        Dict with 'next_step' ('supervisor', 'END') and state updates
    """
    if not supervisor_messages:
        return {"next_step": "END", "notes": [], "research_brief": research_brief}
    
    most_recent_message = supervisor_messages[-1]
    
    # Check exit conditions
    exceeded_allowed_iterations = research_iterations > MAX_RESEARCHER_ITERATIONS
    tool_calls = most_recent_message.get("tool_calls", [])
    no_tool_calls = not tool_calls
    
    research_complete_tool_call = any(
        tool_call.get("function", {}).get("name") == "ResearchComplete"
        for tool_call in tool_calls
    )
    
    if exceeded_allowed_iterations or no_tool_calls or research_complete_tool_call:
        notes = get_notes_from_tool_calls(supervisor_messages)
        return {
            "next_step": "END",
            "notes": notes,
            "research_brief": research_brief
        }
    
    # Process tool calls
    all_tool_messages = []
    raw_notes = []
    
    # Handle think_tool calls
    think_tool_calls = [
        tc for tc in tool_calls
        if tc.get("function", {}).get("name") == "think_tool"
    ]
    
    for tool_call in think_tool_calls:
        try:
            args = json.loads(tool_call["function"]["arguments"])
            reflection_content = args.get("reflection", "")
            if progress_callback:
                try:
                    progress_callback(f"💭 Supervisor Reflection: {reflection_content}")
                except Exception:
                    pass
            all_tool_messages.append({
                "role": "tool",
                "content": f"Reflection recorded: {reflection_content}",
                "tool_call_id": tool_call["id"]
            })
        except (json.JSONDecodeError, KeyError):
            pass
    
    # Handle ConductResearch calls
    conduct_research_calls = [
        tc for tc in tool_calls
        if tc.get("function", {}).get("name") == "ConductResearch"
    ]
    
    if conduct_research_calls:
        try:
            # Limit concurrent research units
            allowed_calls = conduct_research_calls[:MAX_CONCURRENT_RESEARCH_UNITS]
            overflow_calls = conduct_research_calls[MAX_CONCURRENT_RESEARCH_UNITS:]
            
            # Execute research tasks in parallel
            research_tasks = []
            for tool_call in allowed_calls:
                try:
                    args = json.loads(tool_call["function"]["arguments"])
                    research_topic = args.get("research_topic", "")
                    if research_topic:
                        if progress_callback:
                            try:
                                progress_callback(f"🔬 Starting research on: {research_topic[:200]}...")
                            except Exception:
                                pass
                        research_tasks.append(
                            researcher_workflow(
                                research_topic=research_topic,
                                dataset=dataset,
                                progress_callback=progress_callback,
                            )
                        )
                except (json.JSONDecodeError, KeyError):
                    pass
            
            tool_results = await asyncio.gather(*research_tasks, return_exceptions=True)
            
            # Report research completion
            if progress_callback:
                try:
                    completed_count = sum(1 for r in tool_results if not isinstance(r, Exception))
                    progress_callback(f"✅ Completed {completed_count} research task(s)")
                except Exception:
                    pass
            
            # Create tool messages with research results
            for i, (observation, tool_call) in enumerate(zip(tool_results, allowed_calls)):
                if isinstance(observation, Exception):
                    content = f"Error conducting research: {str(observation)}"
                else:
                    content = observation.get("compressed_research", "Error synthesizing research report")
                
                all_tool_messages.append({
                    "role": "tool",
                    "content": content,
                    "tool_call_id": tool_call["id"]
                })
                
                # Collect raw notes
                if isinstance(observation, dict):
                    raw_notes.extend(observation.get("raw_notes", []))
            
            # Handle overflow calls
            for overflow_call in overflow_calls:
                all_tool_messages.append({
                    "role": "tool",
                    "content": f"Error: Did not run this research as you have already exceeded the maximum number of concurrent research units. Please try again with 3 or fewer research units.",
                    "tool_call_id": overflow_call["id"]
                })
                
        except Exception as e:
            # Handle research execution errors
            if is_token_limit_exceeded(e):
                notes = get_notes_from_tool_calls(supervisor_messages)
                return {
                    "next_step": "END",
                    "notes": notes,
                    "research_brief": research_brief
                }
    
    return {
        "next_step": "supervisor",
        "supervisor_messages": all_tool_messages,
        "raw_notes": raw_notes
    }


async def researcher(researcher_messages: List[Dict[str, Any]],research_topic: str, dataset: str) -> Dict[str, Any]:
    """Individual researcher that conducts focused research on specific topics.
    
    Args:
        researcher_messages: List of message dicts for researcher conversation
        research_topic: The specific topic to research
        dataset: The dataset to research
        
    Returns:
        Dict with 'response' (message dict) and 'next_step' ('researcher_tools')
    """
    # Get available tools
    tools = get_all_tools()
    if len(tools) == 0:
        raise ValueError(
            "No tools found to conduct research."
        )
    
    specific_info_dict = initialize.DATASETS[dataset]['specific_info_dict']
    
    # Prepare system prompt
    researcher_prompt = research_system_prompt.format(
        date=get_today_str(),
        deep_research_retrieve_tool_description=specific_info_dict['deep_research_retrieve_tool_description'],
        deep_research_compute_statistics_tool_description=specific_info_dict['deep_research_compute_statistics_tool_description']
    )
    
    # Prepare messages
    messages = [{"role": "system", "content": researcher_prompt}] + researcher_messages
    
    # Get response with tools
    response = await get_llm_response_with_tools(
        messages=messages,
        tools=tools
    )
    
    return {
        "response": response,
        "next_step": "researcher_tools"
    }


async def execute_tool_safely(tool_name: str, args: Dict[str, Any], dataset: str) -> str:
    """Safely execute a tool with error handling.
    
    Args:
        tool_name: Name of the tool to execute
        args: Arguments for the tool
        dataset: The dataset to research
        
    Returns:
        String result from tool execution
    """

    logger.info(f"Executing tool: {tool_name}")
    try:
        if tool_name == "think_tool":
            reflection = args.get("reflection", "")
            return think_tool_function(reflection)

        elif tool_name == "retrieve":
            query = args.get("query", "")
            if not query:
                return "Error: retrieve tool requires a 'query' parameter"
            
            messages = [{"role": "user", "content": query}]
            
            # Call retrieve function
            df = await retrieve(messages, dataset)
            
            # Convert DataFrame to a useful string representation
            if df.empty:
                return "No relevant geopolitical events found for the given query."

            return str(df.to_dict(orient='records'))

        elif tool_name == "compute_statistics":
            query = args.get("query", "")
            logger.info(f"Computing statistics with query: {query}")
            if not query:
                return "Error: compute_statistics tool requires a 'query' parameter"
            
            messages = [{"role": "user", "content": query}]
            
            results = quantitative_analysis(messages, dataset)
            results = results["other_results"]
            logger.debug(f"Quantitative analysis results: {results}")
            return str(results)

        else:
            return f"Tool {tool_name} not yet implemented"
    except Exception as e:
        return f"Error executing tool {tool_name}: {str(e)}"


async def researcher_tools(researcher_messages: List[Dict[str, Any]],tool_call_iterations: int, dataset: str, progress_callback=None) -> Dict[str, Any]:
    """Execute tools called by the researcher, including search tools and strategic thinking.
    
    Args:
        researcher_messages: List of message dicts including the latest assistant response
        tool_call_iterations: Current iteration count
        specific_info_dict: Dictionary containing dataset-specific information
        progress_callback: Optional callback for progress updates
        
    Returns:
        Dict with 'next_step' ('researcher', 'compress_research') and state updates
    """
    if not researcher_messages:
        return {"next_step": "compress_research", "researcher_messages": []}
    
    most_recent_message = researcher_messages[-1]
    
    # Check early exit conditions
    tool_calls = most_recent_message.get("tool_calls", [])
    has_tool_calls = bool(tool_calls)
    
    if not has_tool_calls:
        return {"next_step": "compress_research", "researcher_messages": []}
    
    # Execute all tool calls
    tool_outputs = []
    for tool_call in tool_calls:
        function_info = tool_call.get("function", {})
        tool_name = function_info.get("name", "")
        
        try:
            args = json.loads(function_info.get("arguments", "{}"))
        except json.JSONDecodeError:
            args = {}
        
        # Report tool usage
        if progress_callback:
            try:
                if tool_name == "retrieve":
                    query = args.get("query", "")
                    progress_callback(f"🔍 Searching database: {query[:150]}...")
                elif tool_name == "compute_statistics":
                    query = args.get("query", "")
                    progress_callback(f"📊 Computing statistics: {query[:150]}...")
                elif tool_name == "think_tool":
                    reflection = args.get("reflection", "")
                    progress_callback(f"💭 Researcher thinking: {reflection[:200]}...")
                else:
                    progress_callback(f"🔧 Using tool: {tool_name}")
            except Exception:
                pass
        
        observation = await execute_tool_safely(tool_name, args, dataset)
        
        # Report tool results
        if progress_callback:
            try:
                if tool_name == "retrieve":
                    if "Found" in observation and "relevant" in observation:
                        progress_callback(f"✅ {observation.split(chr(10))[0]}")
                elif tool_name == "compute_statistics":
                    progress_callback("✅ Statistics computed")
            except Exception:
                pass
        
        tool_outputs.append({
            "role": "tool",
            "content": observation,
            "tool_call_id": tool_call["id"]
        })
    
    # Check late exit conditions
    exceeded_iterations = tool_call_iterations >= 3
    research_complete_called = any(
        tool_call.get("function", {}).get("name") == "ResearchComplete"
        for tool_call in tool_calls
    )
    
    if exceeded_iterations or research_complete_called:
        return {
            "next_step": "compress_research",
            "researcher_messages": tool_outputs
        }
    
    return {
        "next_step": "researcher",
        "researcher_messages": tool_outputs
    }


async def compress_research(
    researcher_messages: List[Dict[str, Any]],
    dataset: str,
    progress_callback=None,
) -> Dict[str, Any]:
    """Compress and synthesize research findings into a concise, structured summary.
    
    Args:
        researcher_messages: List of message dicts from researcher
        dataset: The dataset to research
        progress_callback: Optional callback for progress updates
        
    Returns:
        Dict with 'compressed_research' and 'raw_notes'
    """
    # Prepare messages for compression
    messages = researcher_messages.copy()
    messages.append({"role": "user", "content": compress_research_simple_human_message})

    specific_info_dict = initialize.DATASETS[dataset]['specific_info_dict']
    
    # Attempt compression with retry logic
    synthesis_attempts = 0
    max_attempts = 3
    
    while synthesis_attempts < max_attempts:
        try:
            compression_prompt = compress_research_system_prompt.format(date=get_today_str(), deep_research_sources_type=specific_info_dict['deep_research_sources_type'], deep_research_citation_rules=specific_info_dict['deep_research_citation_rules'])
            messages_with_system = [{"role": "system", "content": compression_prompt}] + messages
            
            response = await get_llm_response_with_tools(
                messages=messages_with_system,
                max_tokens=MAX_TOKENS_COMPRESSION
            )
            
            # Extract raw notes
            raw_notes_content = "\n".join([
                str(msg.get("content", ""))
                for msg in filter_messages(researcher_messages, include_types=["tool", "assistant"])
            ])
            
            compressed = response.get("content", "")
            if progress_callback:
                try:
                    progress_callback(f"✅ Research compressed: {len(compressed)} characters")
                except Exception:
                    pass
            
            return {
                "compressed_research": compressed,
                "raw_notes": [raw_notes_content] if raw_notes_content else []
            }
            
        except Exception as e:
            synthesis_attempts += 1
            
            if is_token_limit_exceeded(e):
                # Convert to list of dicts for remove_up_to_last_ai_message
                messages = remove_up_to_last_ai_message(messages)
                continue
            
            if synthesis_attempts >= max_attempts:
                break
    
    # Return error result
    raw_notes_content = "\n".join([
        str(msg.get("content", ""))
        for msg in filter_messages(researcher_messages, include_types=["tool", "assistant"])
    ])
    
    return {
        "compressed_research": "Error synthesizing research report: Maximum retries exceeded",
        "raw_notes": [raw_notes_content] if raw_notes_content else []
    }


async def researcher_workflow(research_topic: str, dataset: str, progress_callback=None) -> Dict[str, Any]:
    """Complete workflow for a single researcher.
    
    Args:
        research_topic: The topic to research
        dataset: The dataset to research
        progress_callback: Optional callback for progress updates
        
    Returns:
        Dict with 'compressed_research' and 'raw_notes'
    """
    researcher_messages = [{"role": "user", "content": research_topic}]
    tool_call_iterations = 0
    
    # Research loop
    while tool_call_iterations < MAX_RESEARCHER_ITERATIONS:
        # Get researcher response
        researcher_result = await researcher(researcher_messages, research_topic, dataset)
        researcher_messages.append(researcher_result["response"])
        tool_call_iterations += 1
        
        # Execute tools
        if researcher_result["next_step"] == "researcher_tools":
            tools_result = await researcher_tools(
                researcher_messages,
                tool_call_iterations,
                dataset,
                progress_callback,
            )
            researcher_messages.extend(tools_result.get("researcher_messages", []))
            
            if tools_result["next_step"] == "compress_research":
                if progress_callback:
                    try:
                        progress_callback("📝 Compressing research findings...")
                    except Exception:
                        pass
                break
        
        if tool_call_iterations >= MAX_RESEARCHER_ITERATIONS:
            break
    
    # Compress research
    compression_result = await compress_research(researcher_messages, dataset, progress_callback)
    return compression_result


async def final_report_generation(
    notes: List[str],
    research_brief: str,
    messages: List[Dict[str, Any]],
    dataset: str,
    progress_callback=None,
) -> Dict[str, Any]:
    """Generate the final comprehensive research report with retry logic for token limits.
    
    Args:
        notes: List of research notes/findings
        research_brief: The original research brief
        messages: Original user messages
        dataset: The dataset to research
        progress_callback: Optional callback for progress updates
        
    Returns:
        Dict with 'final_report' and 'messages'
    """
    findings = "\n".join(notes)
    
    specific_info_dict = initialize.DATASETS[dataset]['specific_info_dict']
    
    # Attempt report generation with token limit retry logic
    max_retries = 3
    current_retry = 0
    findings_token_limit = None
    
    while current_retry <= max_retries:
        try:
            final_report_prompt = final_report_generation_prompt.format(
                research_brief=research_brief,
                messages=get_buffer_string(messages),
                findings=findings,
                date=get_today_str(),
                deep_research_relevant_sources_format=specific_info_dict['deep_research_relevant_sources_format'],
                deep_research_citation_rules=specific_info_dict['deep_research_citation_rules']
            )
            
            if progress_callback:
                try:
                    progress_callback("✍️ Writing final report...")
                except Exception:
                    pass
            
            response = await get_llm_response_with_tools(
                messages=[{"role": "user", "content": final_report_prompt}],
                max_tokens=MAX_TOKENS_FINAL_REPORT
            )
            
            final_report = response.get("content", "")
            if progress_callback:
                try:
                    progress_callback(f"📝 Report written: {len(final_report)} characters")
                except Exception:
                    pass
            
            return {
                "final_report": final_report,
                "messages": [response]
            }
            
        except Exception as e:
            logger.error(f"Error generating final report: {e}")
            if is_token_limit_exceeded(e):
                current_retry += 1
                
                if current_retry == 1:
                    model_token_limit = get_model_token_limit(os.environ.get("DEEP_RESEARCH_MODEL_NAME"))
                    if not model_token_limit:
                        return {
                            "final_report": f"Error generating final report: Token limit exceeded, however, we could not determine the model's maximum context length. {e}",
                            "messages": [{"role": "assistant", "content": "Report generation failed due to token limits"}]
                        }
                    findings_token_limit = model_token_limit * 4
                else:
                    findings_token_limit = int(findings_token_limit * 0.9)
                
                findings = findings[:findings_token_limit]
                continue
            else:
                return {
                    "final_report": f"Error generating final report: {e}",
                    "messages": [{"role": "assistant", "content": "Report generation failed due to an error"}]
                }
    
    return {
        "final_report": "Error generating final report: Maximum retries exceeded",
        "messages": [{"role": "assistant", "content": "Report generation failed after maximum retries"}]
    }


async def deep_research_workflow(messages: List[Dict[str, Any]], dataset: str, progress_callback=None) -> Dict[str, Any]:
    """Main deep research workflow from user input to final report.
    
    Args:
        messages: List of user message dicts
        dataset: The dataset to research
        progress_callback: Optional callback function to report progress updates.
                          Should accept a string message as argument.
        
    Returns:
        Dict with 'final_report' and other results
    """
    
    # Step 1: Clarify with user
    clarification_result, next_step = await clarify_with_user(messages)
    
    if next_step == "END":
        return {
            "final_report": None,
            "clarification_question": clarification_result,
            "messages": messages
        }
    
    # Step 2: Write research brief
    research_question, next_step = await write_research_brief(messages, dataset)
    logger.info(f"Research question: {research_question}")
    
    if progress_callback:
        try:
            progress_callback(f"📋 Research Question: {research_question}")
        except Exception:
            pass
    
    # Step 3: Supervisor workflow
    supervisor_messages = []
    research_iterations = 0
    all_notes = []
    
    while research_iterations < 5:
        # Supervisor decides what to do
        supervisor_result = await supervisor(
            supervisor_messages,
            research_question,
            dataset,
        )
        logger.info(f"Supervisor result: {supervisor_result}")
        
        # Report supervisor response
        if progress_callback:
            try:
                response = supervisor_result["response"]
                # Extract content from response dict
                if isinstance(response, dict):
                    content = response.get("content", "")
                    if content:
                        progress_callback(content)
                    elif response.get("tool_calls"):
                        # Format tool calls nicely
                        try:
                            tc = response.get("tool_calls", [])[0]
                            tool_name = tc.get("function", {}).get("name", "unknown")
                            # arguments is a JSON string, not a dict
                            arguments_str = tc.get("function", {}).get("arguments", "{}")
                            try:
                                import json
                                arguments = json.loads(arguments_str)
                                tool_research_topic = arguments.get("research_topic", "unknown")
                            except (json.JSONDecodeError, AttributeError):
                                tool_research_topic = "unknown"
                            progress_callback(f"Calling tool: {tool_name} with research topic: {tool_research_topic}")
                        except (IndexError, KeyError, AttributeError):
                            # Fallback if parsing fails
                            tool_calls = response.get("tool_calls", [])
                            tool_names = [tc.get("function", {}).get("name", "unknown") for tc in tool_calls]
                            progress_callback(f"Calling tools: {', '.join(tool_names)}")
            except Exception:
                pass  # Don't break workflow if callback fails
        
        supervisor_messages.append(supervisor_result["response"])
        research_iterations += 1
        
        # Execute supervisor tools
        if supervisor_result["next_step"] == "supervisor_tools":
            tools_result = await supervisor_tools(
                supervisor_messages,
                research_question,
                research_iterations,
                dataset,
                progress_callback,
            )
            logger.info(f"Tools result: {tools_result}")

            if tools_result.get("raw_notes"):
                all_notes.extend(tools_result["raw_notes"])
            
            if tools_result["next_step"] == "END":
                # Collect final notes
                notes = tools_result.get("notes", [])
                if notes:
                    all_notes.extend(notes)
                break
            
            # Add tool messages and continue
            supervisor_messages.extend(tools_result.get("supervisor_messages", []))
    
    # Step 4: Generate final report
    final_notes = all_notes if all_notes else get_notes_from_tool_calls(supervisor_messages)
    
    if progress_callback:
        try:
            progress_callback(f"📄 Generating final report from {len(final_notes)} research note(s)...")
        except Exception:
            pass
    
    report_result = await final_report_generation(
        final_notes,
        research_question,
        messages,
        dataset,
        progress_callback,
    )
    
    if progress_callback:
        try:
            if report_result.get("final_report"):
                progress_callback("✅ Final report generated successfully!")
        except Exception:
            pass
    
    return report_result
