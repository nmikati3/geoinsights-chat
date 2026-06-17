"""Utility functions for deep research without LangChain dependencies."""

import pandas as pd
from typing import List, Dict, Any, Optional
from openai import OpenAI
import os

CLIENT = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


def get_today_str() -> str:
    """Get today's date as a string."""
    return str(pd.Timestamp.now())[:10]


def get_buffer_string(messages: List[Dict[str, Any]]) -> str:
    """Convert messages list to a string representation."""
    result = []
    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if content:
            result.append(f"{role}: {content}")
    return "\n".join(result)


def filter_messages(messages: List[Dict[str, Any]], include_types: List[str] = None) -> List[Dict[str, Any]]:
    """Filter messages by type. include_types can be 'user', 'assistant', 'system', 'tool'."""
    if include_types is None:
        return messages
    
    filtered = []
    for msg in messages:
        role = msg.get("role", "")
        if role in include_types or (role == "assistant" and "ai" in include_types):
            filtered.append(msg)
    return filtered


def remove_up_to_last_ai_message(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove messages up to and including the last assistant message."""
    result = []
    found_last_ai = False
    
    # Iterate backwards to find the last assistant message
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "assistant" and not found_last_ai:
            found_last_ai = True
            continue
        if found_last_ai:
            result.insert(0, messages[i])
    
    return result if found_last_ai else messages


def get_notes_from_tool_calls(messages: List[Dict[str, Any]]) -> List[str]:
    """Extract notes from tool calls in messages."""
    notes = []
    for msg in messages:
        if msg.get("role") == "tool":
            content = msg.get("content", "")
            if content:
                notes.append(str(content))
        elif msg.get("role") == "assistant":
            # Check for tool calls in assistant messages
            tool_calls = msg.get("tool_calls", [])
            for tool_call in tool_calls:
                if tool_call.get("type") == "function":
                    function_name = tool_call.get("function", {}).get("name", "")
                    if function_name == "think_tool":
                        # Extract reflection from think_tool
                        args = tool_call.get("function", {}).get("arguments", {})
                        if isinstance(args, str):
                            import json
                            try:
                                args = json.loads(args)
                            except (json.JSONDecodeError, TypeError):
                                pass
                        reflection = args.get("reflection", "") if isinstance(args, dict) else ""
                        if reflection:
                            notes.append(f"Reflection: {reflection}")
    return notes


def openai_websearch_called(message: Dict[str, Any]) -> bool:
    """Check if OpenAI web search was called in the message."""
    # OpenAI web search is indicated by specific tool calls or content
    if message.get("role") == "assistant":
        tool_calls = message.get("tool_calls", [])
        for tool_call in tool_calls:
            if tool_call.get("type") == "web_search" or tool_call.get("id", "").startswith("call_"):
                return True
    return False


def is_token_limit_exceeded(error: Exception) -> bool:
    """Check if error is due to token limit exceeded."""
    error_str = str(error).lower()
    token_errors = [
        "token",
        "context length",
        "maximum context length",
        "exceeds maximum",
        "too many tokens"
    ]
    return any(term in error_str for term in token_errors)


def get_model_token_limit(model: str) -> Optional[int]:
    """Get token limit for a model. Returns None if unknown."""
    # Common model token limits
    model_limits = {
        "gpt-4": 8192,
        "gpt-4-turbo": 128000,
        "gpt-4o": 128000,
        "gpt-3.5-turbo": 16385,
        "gpt-4.1": 128000,  # Assuming this is similar to gpt-4o
        "gpt-5.2": 128000,
    }
    
    # Check for partial matches
    for key, limit in model_limits.items():
        if key in model.lower():
            return limit
    
    return None


def get_all_tools() -> List[Dict[str, Any]]:
    """Get all available tools for research. Returns list of tool definitions."""
    # Define think_tool
    think_tool = {
        "type": "function",
        "function": {
            "name": "think_tool",
            "description": """Tool for strategic reflection on research progress and decision-making.

Use this tool after each search to analyze results and plan next steps systematically.
This creates a deliberate pause in the research workflow for quality decision-making.

When to use:
- After receiving search results: What key information did I find?
- Before deciding next steps: Do I have enough to answer comprehensively?
- When assessing research gaps: What specific information am I still missing?
- Before concluding research: Can I provide a complete answer now?

Reflection should address:
1. Analysis of current findings - What concrete information have I gathered?
2. Gap assessment - What crucial information is still missing?
3. Quality evaluation - Do I have sufficient evidence/examples for a good answer?
4. Strategic decision - Should I continue searching or provide my answer?""",
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
    
    # Define retrieve tool for geopolitical events
    retrieve_tool = {
        "type": "function",
        "function": {
            "name": "retrieve",
            "description": """Retrieve a pandas dataframe of geopolitical events most relevant to a query.

This tool searches through a database of geopolitical incidents (cyberattacks, military aid, sanctions, 
military offensives, international summits) and returns the most relevant events based on:
1. Metadata filtering (countries, dates, incident types, etc.)
2. Semantic vector search
3. Keyword search (BM25)
4. Reranking by relevance
5. To limit memory usage, the tool will return only the 3 columns: incident_start_date, incident_summary, and url_list.

The tool returns a dataframe with columns: incident_start_date, incident_summary, and url_list.
Use this tool when you need to find specific geopolitical events or incidents related to your research query.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query describing what geopolitical events or incidents you're looking for. This should be a clear description of the type of events, countries, time periods, or incident types you want to find."
                    }
                },
                "required": ["query"]
            }
        }
    }

    # Define quantitative analysis tool
    compute_statistics_tool = {
        "type": "function",
        "function": {
            "name": "compute_statistics",
            "description": """Generate and execute Python code for quantitative data analysis.

This tool uses an LLM to generate Python code based on your analysis request, executes it in a sandbox environment,
and returns the results. The generated code can perform data analysis, basically anything with numbers is what this tool is for.

The tool automatically:
1. Generates Python code using an LLM based on your query
2. Executes the code in a secure sandbox environment
3. Collects results, saved to /mnt/other_results

Returns a dictionary with key: 'other_results', containing a list of results.
Use this tool when you need to perform quantitative analysis, generate data-driven insights such as computing statistics, calculating, finding the number of incidents by country, etc...""",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "A clear description of the quantitative analysis you want to perform. Describe what data you want to analyze, what visualizations or tables you need, and any specific calculations or insights you're looking for."
                    }
                },
                "required": ["query"]
            }
        }
    }
    
    return [think_tool, retrieve_tool, compute_statistics_tool]


def think_tool(reflection: str) -> str:
    """Tool for strategic reflection on research progress and decision-making."""
    return f"Reflection recorded: {reflection}"