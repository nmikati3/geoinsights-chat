from geoinsights_backend.services.llm import stream_llm_response, get_structured_llm_response
from geoinsights_backend.services.base_prompts import compute_text_system_prompt, compute_malicious_system_prompt, compute_quantitative_response_system_prompt
import asyncio
import pandas as pd
from pydantic import BaseModel
from geoinsights_backend.services.retrieval import retrieve
from geoinsights_backend.services.e2b import quantitative_analysis
from geoinsights_backend.services import initialize


def get_search_response(messages):

  response = stream_llm_response(messages,search=True)

  return response


def get_text_response(messages,dataset):

  results = asyncio.run(retrieve(messages,dataset))

  specific_info_dict = initialize.DATASETS[dataset]['specific_info_dict']
  system_prompt = compute_text_system_prompt(specific_info_dict,results)

  messages = messages[:-1] + [{"role": "system","content": system_prompt}] + messages[-1:] # insert the system prompt before the last message

  response = stream_llm_response(messages,search=False)

  return response


def generate_quantitative_response(messages,dataset):

  results = quantitative_analysis(messages,dataset)

  messages = [
    {'role':'system','content':compute_quantitative_response_system_prompt()},
    {'role':'user','content':str(results)}
  ]

  response_generator = stream_llm_response(messages)

  return results, response_generator


def generate_figure_response(messages,dataset):

  results = quantitative_analysis(messages,dataset)

  return results