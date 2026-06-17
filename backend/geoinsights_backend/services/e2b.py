import json
import numpy as np
import base64
import re
from geoinsights_backend.services import initialize
from geoinsights_backend.services.llm import get_structured_llm_response
from geoinsights_backend.services.base_prompts import compute_quantitative_analysis_system_prompt
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
# Ensure the logger has a handler (in case logging wasn't configured yet)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(handler)

def decode_bdata_array(bdata_dict):
    """Decode a single E2B bdata dict into a NumPy array / Python list."""

    dtype = bdata_dict['dtype']
    bdata_base64 = bdata_dict['bdata']
    arr = np.frombuffer(base64.b64decode(bdata_base64), dtype=dtype)

    return arr.tolist()


def fix_figure_bdata(fig_dict):
    """
    Recursively replace all bdata dicts in a Plotly figure dict
    with plain Python lists.
    """

    for trace in fig_dict.get('data', []):
        for key in ['x', 'y', 'z']:  # extend to other axes if needed
            if key in trace and isinstance(trace[key], dict):
                if 'bdata' in trace[key] and 'dtype' in trace[key]:
                    trace[key] = decode_bdata_array(trace[key])

    return fig_dict


def read_results(folder,dataset,fig=False):

  sandbox = initialize.DATASETS[dataset]['SANDBOX']

  files = sandbox.files.list(folder)
  paths = [x.path for x in files]

  results = []

  for result_path in paths:
    try:
      result_json_str = sandbox.files.read(result_path)
      logger.info(f"Result JSON String: {result_json_str[:200]}...")  # Log first 200 chars to avoid huge logs
      
      # Skip empty or incomplete JSON files
      if not result_json_str or not result_json_str.strip():
        logger.warning(f"Skipping empty file: {result_path}")
        continue
      
      result_records = json.loads(result_json_str)

      if fig:
        # Convert all bdata arrays to lists
        result_records = fix_figure_bdata(result_records)

      results.append(result_records)
    except json.JSONDecodeError as e:
      logger.error(f"Failed to parse JSON from {result_path}: {e}")
      logger.error(f"Content (first 500 chars): {result_json_str[:500] if result_json_str else 'Empty'}")
      # Continue processing other files instead of failing completely
      continue
    except Exception as e:
      logger.error(f"Error reading result from {result_path}: {e}")
      continue

  for result_path in paths:
    try:
      sandbox.files.remove(result_path)
    except Exception as e:
      logger.warning(f"Failed to remove file {result_path}: {e}")

  return results


def validate_code_security(code: str) -> None:
    """
    Perform static analysis on generated code to block dangerous patterns.
    Raises ValueError if dangerous patterns are detected.
    """

    logger.info(f"Validating code security: {code}")
    # Dangerous patterns to block
    dangerous_patterns = [
        (r'\bos\.system\s*\(', 'os.system() calls are not allowed'),
        (r'\bsubprocess\s*\.', 'subprocess module is not allowed'),
        (r'\bsocket\s*\.', 'socket module is not allowed'),
        (r'__import__\s*\(', '__import__() is not allowed'),
        (r'\beval\s*\(', 'eval() is not allowed'),
        (r'\bexec\s*\(', 'exec() is not allowed'),
        (r'\bcompile\s*\(', 'compile() is not allowed'),
    ]
    
    # Check for dangerous patterns
    for pattern, message in dangerous_patterns:
        if re.search(pattern, code, re.IGNORECASE):
            logger.warning(f"Code validation failed: {message}")
            raise ValueError(f"Code validation failed: {message}")


def run_code_and_get_results(code,dataset,deep_research=False):

  # Validate code security before execution
  validate_code_security(code)
  
  if deep_research:
    #spinning up a new sandbox specifically for the deep research
    sandbox = initialize.DATASETS[dataset]['create_sandbox'](initialize.DATASETS[dataset]['DATA'])
  else:
    sandbox = initialize.DATASETS[dataset]['SANDBOX']

  execution = sandbox.run_code(code)
  
  # Check for execution errors
  if execution.error:
    logger.error(f"Code execution failed: {execution.error}")
    logger.error(f"Error details: {execution.error.value if hasattr(execution.error, 'value') else execution.error}")

  figures = read_results("/mnt/figures",dataset,fig=True)
  tables = read_results("/mnt/tables",dataset,fig=False)
  other_results = read_results("/mnt/other_results",dataset,fig=False)

  results = {
      'figures':figures,
      'tables':tables,
      'other_results':other_results,
      'code':code
  }

  return results


def quantitative_analysis(messages,dataset,deep_research=False):

  specific_info_dict = initialize.DATASETS[dataset]['specific_info_dict']
  system_prompt = compute_quantitative_analysis_system_prompt(specific_info_dict)

  messages = messages[:-1] + [{"role":"system","content":system_prompt}] + messages[-1:]

  class Code(BaseModel):
    code: str

  response = get_structured_llm_response(Code,messages)

  code = response.code

  code = """
os.makedirs("/mnt/figures", exist_ok=True)
os.makedirs("/mnt/tables", exist_ok=True)
os.makedirs("/mnt/other_results", exist_ok=True)

""" + code

  results = run_code_and_get_results(code,dataset,deep_research)

  return results