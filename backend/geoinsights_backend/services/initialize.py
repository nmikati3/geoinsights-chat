import logging
from e2b_code_interpreter import Sandbox
from sentence_transformers import CrossEncoder # type: ignore
from geoinsights_backend.services.datasets.datasets import DATASETS

logger = logging.getLogger(__name__)

# Global variables
RERANKER = None


def initialize_reranker():
    """Initialize the reranker."""
    global RERANKER
    if RERANKER is None:
        RERANKER = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    return RERANKER


def initialize_data():

    """Initialize the global DATA variables by loading data from GCS."""
    for dataset in DATASETS.keys():
        if DATASETS[dataset]['DATA'] is None:
            logger.info(f"Loading {dataset} data from Google Cloud Storage...")
            try:
                DATASETS[dataset]['DATA'] = DATASETS[dataset]['load_data']()
                logger.info(f"Data loaded successfully. Shape: {DATASETS[dataset]['DATA'].shape}")
            except Exception as e:
                logger.error(f"Failed to load data: {e}")
                raise
        else:
            logger.info(f"{dataset} data already loaded. Shape: {DATASETS[dataset]['DATA'].shape}")


def initialize_sandbox():

    # Close existing sandboxes if they exist
    for dataset in DATASETS.keys():
        if DATASETS[dataset]['SANDBOX'] is not None:
            logger.info(f"Closing existing {dataset} sandbox...")
            try:
                DATASETS[dataset]['SANDBOX'].kill()
            except Exception as e:
                logger.warning(f"Error killing existing {dataset} sandbox: {e}")
            finally:
                DATASETS[dataset]['SANDBOX'] = None

    # Create new sandboxes
    for dataset in DATASETS.keys():
        if DATASETS[dataset]['SANDBOX'] is None:
            logger.info(f"Creating new {dataset} sandbox...")
            try:
                DATASETS[dataset]['SANDBOX'] = DATASETS[dataset]['create_sandbox'](DATASETS[dataset]['DATA'])
                logger.info(f"Sandbox created successfully.")
            except Exception as e:
                logger.error(f"Failed to create sandbox: {e}")
                raise
    


def get_list_of_running_sandboxes():
    """Get the list of running sandboxes."""
    paginator = Sandbox.list()
    running_sandboxes = paginator.next_items()
    return running_sandboxes


def is_running():
    """Check if the sandbox is running."""
    for dataset in DATASETS.keys():
        if DATASETS[dataset]['SANDBOX'] is not None:
            if not DATASETS[dataset]['SANDBOX'].is_running():
                return False
    return True