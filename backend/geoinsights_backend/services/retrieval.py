import asyncio
import os
# Set OpenMP to single-threaded BEFORE importing FAISS to prevent threading conflicts
# This is critical on macOS when FAISS is called from async executors
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
os.environ['NUMEXPR_NUM_THREADS'] = '1'

import pandas as pd
from pydantic import BaseModel, field_validator
from typing import List
from geoinsights_backend.services.llm import get_structured_llm_response, compute_embedding
import numpy as np
import faiss
from rank_bm25 import BM25Okapi
from geoinsights_backend.services.base_prompts import compute_filter_data_system_prompt
from geoinsights_backend.services import initialize
import threading

# Configure FAISS to use single-threaded mode to prevent OpenMP conflicts
# This is critical when FAISS is called from async executors on macOS
try:
    faiss.omp_set_num_threads(1)
except AttributeError:
    # Older versions of FAISS might not have this function
    pass

# Lock to serialize FAISS operations (FAISS is not thread-safe)
_faiss_lock = threading.Lock()

K_SEMANTIC_SEARCH = 10 #50 (prod value)
K_KEYWORD_SEARCH = 20 #200 (prod value)

def apply_filter_group(df, conditions, specific_info_dict):

  mask = pd.Series([True] * len(df))

  for col, val in conditions:

    # Special case: incident_start_date with comparison operators
    if col == specific_info_dict['date_column']:
      if val.startswith(">="):
        date_val = pd.to_datetime(val[2:].strip())
        mask &= df[col] >= date_val
      elif val.startswith("<="):
        date_val = pd.to_datetime(val[2:].strip())
        mask &= df[col] <= date_val
      else:
        # exact match if it's not a comparison
        date_val = pd.to_datetime(val)
        mask &= df[col] == date_val

    elif col in specific_info_dict['columns_as_list']:
      mask &= df[col].apply(lambda x: val in x)

    else:
      mask &= df[col] == val

  return df[mask]


def apply_filter_matrix(df, filter_matrix, specific_info_dict):
  frames = []

  for group in filter_matrix:
    filtered = apply_filter_group(df, group, specific_info_dict)
    filtered = list(filtered[specific_info_dict['id']])
    frames += filtered

  # OR logic across groups = union of all filtered rows
  if frames:
    return df[df[specific_info_dict['id']].isin(frames)].reset_index(drop=True)
  else:
    return df.copy(deep=True)


def filter_data(data,messages,specific_info_dict):

  system_prompt = compute_filter_data_system_prompt(specific_info_dict)

  messages = messages[:-1] + [{"role": "system","content": system_prompt}] + messages[-1:] # insert the system prompt before the last message

  class Matrix(BaseModel):
    matrix: List[List[List[str]]]

    @field_validator("matrix")
    def ensure_pairs(cls, value):
      for row in value:
        for pair in row:
          if len(pair) != 2:
              raise ValueError("Each item must contain exactly two strings.")
      return value

  filters = get_structured_llm_response(Matrix,messages)
  filters = filters.matrix
  filtered_data = apply_filter_matrix(data, filters, specific_info_dict)

  return filtered_data


def keyword_search(data,user_prompt,specific_info_dict,n=K_KEYWORD_SEARCH):

  corpus = list(data[specific_info_dict['text_column']].dropna().unique())

  tokenized_corpus = [doc.split(" ") for doc in corpus]

  bm25 = BM25Okapi(tokenized_corpus)

  tokenized_query = user_prompt.split(" ")

  relevant_documents = bm25.get_top_n(tokenized_query, corpus, n=n)

  return list(data[data[specific_info_dict['text_column']].isin(relevant_documents)][specific_info_dict['id']].unique())


def get_index(df):
  # Note: This function should only be called from within vector_search
  # which handles the FAISS locking. FAISS operations are not thread-safe.
  emb_matrix = np.array(list(df['embedding']), dtype="float32")
  dim = emb_matrix.shape[1]
  index = faiss.IndexFlatIP(dim)  # inner product similarity; normalize beforehand

  faiss.normalize_L2(emb_matrix)
  index.add(emb_matrix)

  return index


# Helper: vector search tool
def vector_search(df,query,specific_info_dict, k=K_SEMANTIC_SEARCH):
  # Compute embedding outside the lock (not a FAISS operation)
  q_emb = compute_embedding(query)
  
  # Lock all FAISS operations (index creation, normalization, and search)
  with _faiss_lock:
    index = get_index(df)

    qv = np.array([q_emb], dtype="float32")
    faiss.normalize_L2(qv)
    D, I = index.search(qv, k)

    ids = I[0].tolist()
    rows = df.iloc[ids]

    return list(rows[specific_info_dict['id']].dropna().unique())


def rerank(data,user_prompt,specific_info_dict,k=100):

  reranker = initialize.RERANKER

  summaries = list(data[specific_info_dict['text_column']])

  pairs = [(user_prompt, summary) for summary in summaries]
  rerank_scores = reranker.predict(pairs)

  data['scores'] = rerank_scores

  data = data.sort_values('scores',ascending=False).head(k)[specific_info_dict['columns_to_keep_in_rerank']]

  return data


async def async_vector_search(data, user_prompt,specific_info_dict):
  loop = asyncio.get_event_loop()
  return await loop.run_in_executor(None, vector_search, data, user_prompt, specific_info_dict, K_SEMANTIC_SEARCH)


async def async_keyword_search(data, user_prompt,specific_info_dict):
  loop = asyncio.get_event_loop()
  return await loop.run_in_executor(None, keyword_search, data, user_prompt, specific_info_dict, K_KEYWORD_SEARCH)


async def retrieve(messages,dataset):

  user_prompt = messages[-1]['content']

  # metadata filtering (sync)
  specific_info_dict = initialize.DATASETS[dataset]['specific_info_dict']
  data = initialize.DATASETS[dataset]['DATA']
  
  filtered_data = filter_data(data, messages, specific_info_dict)

  # run the two searches concurrently
  vec_task = asyncio.create_task(async_vector_search(filtered_data, user_prompt, specific_info_dict))
  key_task = asyncio.create_task(async_keyword_search(filtered_data, user_prompt, specific_info_dict))

  incident_ids_semantic_search, incident_ids_keyword_search = await asyncio.gather(
      vec_task, key_task
  )

  # combine the two lists of incident_ids
  final_ids = incident_ids_semantic_search + incident_ids_keyword_search

  # filter dataframe
  filtered_data = filtered_data[filtered_data[specific_info_dict['id']].isin(final_ids)]

  # rerank (can also be async if you want)
  filtered_data = rerank(filtered_data, user_prompt, specific_info_dict)

  return filtered_data
