import os
from openai import OpenAI
from openai import APIError as OpenAIAPIError
from geoinsights_backend.services.base_prompts import compute_create_title_from_messages_prompt
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)


MODEL_NAME = os.environ.get("MODEL_NAME")
SEARCH_MODEL_NAME = os.environ.get("SEARCH_MODEL_NAME")
DEEP_RESEARCH_MODEL_NAME = os.environ.get("DEEP_RESEARCH_MODEL_NAME")
CODE_MODEL_NAME = os.environ.get("CODE_MODEL_NAME")
CLIENT = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
MAX_TOKENS = int(os.environ.get("MAX_TOKENS"))


def stream_llm_response(messages,search=False):

  if search:
    response = CLIENT.chat.completions.create(
      model=SEARCH_MODEL_NAME,
      web_search_options={},
      messages=messages,
      stream=True
    )

  else:
    response = CLIENT.chat.completions.create(
      model=MODEL_NAME,
      messages=messages,
      stream=True,
      max_tokens=MAX_TOKENS,
      temperature=0,
      top_p=0
    )

  try:
    for chunk in response:
      if chunk.choices and chunk.choices[0].delta:
        content = chunk.choices[0].delta.content
        if content:
          yield content

  except OpenAIAPIError as e:
    logger.error(f"OpenAI API error during streaming: {e}")
    yield f"\n\n[Error: API error]"

  except Exception as e:
    logger.error(f"Unexpected error during streaming: {e}", exc_info=True)
    yield f"\n\n[Error: Unexpected error occurred]"


def compute_embedding(query):

  return CLIENT.embeddings.create(model="text-embedding-3-small", input=query).data[0].embedding


def get_structured_llm_response(response_format,messages):
  
  response = CLIENT.chat.completions.parse(
    model=CODE_MODEL_NAME,
    temperature=0,
    top_p=0,
    response_format=response_format,
    messages=messages,
    timeout=60
  ).choices[0].message.parsed

  return response


async def get_llm_response_with_tools(messages, tools=None, model=DEEP_RESEARCH_MODEL_NAME, max_tokens=None, temperature=0, top_p=0):
  """Get LLM response with optional tool calling support.
  
  Args:
    messages: List of message dicts with 'role' and 'content'
    tools: Optional list of tool definitions in OpenAI format
    model: Model name (defaults to MODEL_NAME)
    max_tokens: Maximum tokens (optional)
    temperature: Temperature setting
    top_p: Top-p setting
    
  Returns:
    Dict with 'content', 'role', and optionally 'tool_calls'
  """
  
  kwargs = {
    "model": model,
    "messages": messages,
    "temperature": temperature,
    "top_p": top_p,
  }
  
  if max_tokens:
    if model == 'gpt-5.2':
      kwargs["max_completion_tokens"] = max_tokens
    else:
      kwargs["max_tokens"] = max_tokens
    
  if tools:
    kwargs["tools"] = tools
    kwargs["tool_choice"] = "auto"
  
  response = CLIENT.chat.completions.create(**kwargs)
  
  message = response.choices[0].message
  
  result = {
    "role": message.role,
    "content": message.content or "",
  }
  
  if message.tool_calls:
    result["tool_calls"] = [
      {
        "id": tc.id,
        "type": tc.type,
        "function": {
          "name": tc.function.name,
          "arguments": tc.function.arguments
        }
      }
      for tc in message.tool_calls
    ]
  
  return result


def create_title_from_messages(messages):

    class CreateTitleFromMessages(BaseModel):
        title: str

    system_prompt = compute_create_title_from_messages_prompt()
    messages = messages[:-1] + [{"role": "system", "content": system_prompt}] + messages[-1:]

    response = get_structured_llm_response(CreateTitleFromMessages, messages)
    
    return response.title