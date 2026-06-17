import os
import json
import pandas as pd
from google.cloud import storage
import logging
from e2b_code_interpreter import Sandbox
from io import StringIO
import ast


logger = logging.getLogger(__name__)


def load_geopolitics_data():
    """Load data from Google Cloud Storage and return as pandas DataFrame."""
    bucket_name = os.environ.get("BUCKET_NAME")
        
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)

    file_path = "cross-analyses/all_incidents.parquet"

    # Get the file from GCS
    blob = bucket.blob(file_path)
    with blob.open("rb") as f:
        data = pd.read_parquet(f)

    data['embedding'] = data['embedding'].apply(lambda x: json.loads(x))
    data['incident_start_date'] = pd.to_datetime(data['incident_start_date'])
    data['url_list'] = data['url_list'].apply(lambda x: json.loads(x))
    data['source_url_list'] = data['source_url_list'].apply(lambda x: json.loads(x))
    data['initiating_countries'] = data['initiating_countries'].apply(lambda x: json.loads(x))
    data['benefiting_countries'] = data['benefiting_countries'].apply(lambda x: json.loads(x))
    data['receiving_countries'] = data['receiving_countries'].apply(lambda x: json.loads(x))
    data['receiving_economic_sectors'] = data['receiving_economic_sectors'].apply(lambda x: json.loads(x))
    data['initiators'] = data['initiators'].apply(lambda x: json.loads(x))
    data['beneficiaries'] = data['beneficiaries'].apply(lambda x: json.loads(x))
    data['receivers'] = data['receivers'].apply(lambda x: json.loads(x))
    data['incident_sub_types'] = data['incident_sub_types'].apply(lambda x: json.loads(x))

    return data


def create_geopolitics_sandbox(data):

    # Create new sandbox
    logger.info("Creating new sandbox...")
    sandbox = Sandbox.create(timeout=3600, allow_internet_access=False, request_timeout=600)
    
    # EXTREMELY IMPORTANT: the way the data is loaded into the sandbox matters a lot
    # Using another format to upload the data (e.g.: JSON, will make the files saved have a different encoding and it will prevent the data from being correctly returned)
    text_buffer = StringIO()
    data[[
        'incident_id',
        'incident_start_date',
        'number_of_reports',
        'url_list',
        'source_url_list',
        'initiating_countries',
        'benefiting_countries',
        'receiving_countries',
        'receiving_economic_sectors',
        'initiators',
        'beneficiaries',
        'receivers',
        'incident_sub_types',
        'incident_type',
        'incident_summary',
        'number_of_distinct_receivers'
    ]].to_csv(text_buffer, index=False)
    text_buffer.seek(0)

    with text_buffer as file:
        sandbox.files.write("/home/data", file)

    initialization_code = """
import plotly.graph_objects as go
import pandas as pd
import plotly.express as px
import os
import ast
from plotly.utils import PlotlyJSONEncoder

os.makedirs("/mnt/figures", exist_ok=True)
os.makedirs("/mnt/tables", exist_ok=True)
os.makedirs("/mnt/other_results", exist_ok=True)

DATA = pd.read_csv("/home/data")

DATA['incident_start_date'] = pd.to_datetime(DATA['incident_start_date'])
DATA['initiating_countries'] = DATA['initiating_countries'].apply(lambda x: ast.literal_eval(x))
DATA['benefiting_countries'] = DATA['benefiting_countries'].apply(lambda x: ast.literal_eval(x))
DATA['receiving_countries'] = DATA['receiving_countries'].apply(lambda x: ast.literal_eval(x))
DATA['receiving_economic_sectors'] = DATA['receiving_economic_sectors'].apply(lambda x: ast.literal_eval(x))
DATA['initiators'] = DATA['initiators'].apply(lambda x: ast.literal_eval(x))
DATA['beneficiaries'] = DATA['beneficiaries'].apply(lambda x: ast.literal_eval(x))
DATA['receivers'] = DATA['receivers'].apply(lambda x: ast.literal_eval(x))
DATA['incident_sub_types'] = DATA['incident_sub_types'].apply(lambda x: ast.literal_eval(x))

"""

    _ = sandbox.run_code(initialization_code, request_timeout=600)
    
    logger.info(f"Sandbox created successfully. Sandbox ID: {sandbox.sandbox_id if hasattr(sandbox, 'sandbox_id') else 'N/A'}")

    return sandbox


def load_cyberattacks_data():

    """Load data from Google Cloud Storage and return as pandas DataFrame."""
    bucket_name = os.environ.get("BUCKET_NAME")
        
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)

    file_path = "cyber/incidents/incidents.csv"

    # Get the file from GCS
    blob = bucket.blob(file_path)
    with blob.open("r") as f:
        data = pd.read_csv(f)

    file_path = "cyber/incidents/incidents_embeddings.csv"

    # Get the file from GCS
    blob = bucket.blob(file_path)
    with blob.open("r") as f:
        embeddings = pd.read_csv(f)

    embeddings['embedding'] = embeddings[[str(i) for i in range(1536)]].values.tolist()
    embeddings = embeddings.drop(columns=[str(i) for i in range(1536)])

    data = pd.merge(data,embeddings,how='left',on='incident_id')

    data['incident_start_date'] = pd.to_datetime(data['incident_start_date'])
    data['url'] = data['url'].apply(lambda x: ast.literal_eval(x))
    data['cleaned_attacking_countries'] = data['cleaned_attacking_countries'].apply(lambda x: ast.literal_eval(x))
    data['cleaned_targeted_countries'] = data['cleaned_targeted_countries'].apply(lambda x: ast.literal_eval(x))
    data['cleaned_targeted_economic_sectors'] = data['cleaned_targeted_economic_sectors'].apply(lambda x: ast.literal_eval(x))
    data['cleaned_attackers'] = data['cleaned_attackers'].apply(lambda x: ast.literal_eval(x))
    data['cleaned_cyber_incident_type'] = data['cleaned_cyber_incident_type'].apply(lambda x: ast.literal_eval(x))

    return data


def create_cyberattacks_sandbox(data):

    # Create new sandbox
    logger.info("Creating new sandbox...")
    sandbox = Sandbox.create(timeout=3600, allow_internet_access=False, request_timeout=600)
    
    # EXTREMELY IMPORTANT: the way the data is loaded into the sandbox matters a lot
    # Using another format to upload the data (e.g.: JSON, will make the files saved have a different encoding and it will prevent the data from being correctly returned)
    text_buffer = StringIO()
    data[[
        'incident_id',
        'incident_start_date',
        'url',
        'cleaned_attacking_countries',
        'cleaned_targeted_countries',
        'cleaned_targeted_economic_sectors',
        'cleaned_attackers',
        'cleaned_cyber_incident_type',
        'incident_summary'
    ]].to_csv(text_buffer, index=False)
    text_buffer.seek(0)

    with text_buffer as file:
        sandbox.files.write("/home/data", file)

    initialization_code = """
import plotly.graph_objects as go
import pandas as pd
import plotly.express as px
import os
import ast
from plotly.utils import PlotlyJSONEncoder

os.makedirs("/mnt/figures", exist_ok=True)
os.makedirs("/mnt/tables", exist_ok=True)
os.makedirs("/mnt/other_results", exist_ok=True)

DATA = pd.read_csv("/home/data")

DATA['incident_start_date'] = pd.to_datetime(DATA['incident_start_date'])
DATA['url'] = DATA['url'].apply(lambda x: ast.literal_eval(x))
DATA['cleaned_attacking_countries'] = DATA['cleaned_attacking_countries'].apply(lambda x: ast.literal_eval(x))
DATA['cleaned_targeted_countries'] = DATA['cleaned_targeted_countries'].apply(lambda x: ast.literal_eval(x))
DATA['cleaned_targeted_economic_sectors'] = DATA['cleaned_targeted_economic_sectors'].apply(lambda x: ast.literal_eval(x))
DATA['cleaned_attackers'] = DATA['cleaned_attackers'].apply(lambda x: ast.literal_eval(x))
DATA['cleaned_cyber_incident_type'] = DATA['cleaned_cyber_incident_type'].apply(lambda x: ast.literal_eval(x))

"""

    _ = sandbox.run_code(initialization_code, request_timeout=600)
    
    logger.info(f"Sandbox created successfully. Sandbox ID: {sandbox.sandbox_id if hasattr(sandbox, 'sandbox_id') else 'N/A'}")

    return sandbox


def load_amazon_data():

    """Load data from Google Cloud Storage and return as pandas DataFrame."""
    bucket_name = os.environ.get("DEMO_BUCKET_NAME", os.environ.get("BUCKET_NAME"))
        
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)

    file_path = "amazon-reviews-january-2015-labeled.csv"

    # Get the file from GCS
    blob = bucket.blob(file_path)
    with blob.open("r") as f:
        data = pd.read_csv(f)

    data['review_date'] = pd.to_datetime(data['review_date'])
    data['embedding'] = data['embedding'].apply(lambda x: json.loads(x))

    return data


def create_amazon_sandbox(data):

    # Create new sandbox
    logger.info("Creating new sandbox...")
    sandbox = Sandbox.create(timeout=3600, allow_internet_access=False, request_timeout=600)
    
    # EXTREMELY IMPORTANT: the way the data is loaded into the sandbox matters a lot
    # Using another format to upload the data (e.g.: JSON, will make the files saved have a different encoding and it will prevent the data from being correctly returned)
    text_buffer = StringIO()
    data.drop(columns=['embedding']).to_csv(text_buffer, index=False)
    text_buffer.seek(0)

    with text_buffer as file:
        sandbox.files.write("/home/data", file)

    initialization_code = """
import plotly.graph_objects as go
import pandas as pd
import plotly.express as px
import os
import ast
from plotly.utils import PlotlyJSONEncoder

os.makedirs("/mnt/figures", exist_ok=True)
os.makedirs("/mnt/tables", exist_ok=True)
os.makedirs("/mnt/other_results", exist_ok=True)

DATA = pd.read_csv("/home/data")

DATA['review_date'] = pd.to_datetime(DATA['review_date'])

"""

    _ = sandbox.run_code(initialization_code, request_timeout=600)
    
    logger.info(f"Sandbox created successfully. Sandbox ID: {sandbox.sandbox_id if hasattr(sandbox, 'sandbox_id') else 'N/A'}")

    return sandbox