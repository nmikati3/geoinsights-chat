import os

# Environment validation
def validate_environment():

    if os.environ.get("RUN",'dev') == "dev":
        from dotenv import load_dotenv
        from pathlib import Path

        # Clear existing environment variables that we want to load from .env
        for key in ['BUCKET_NAME','OPENAI_API_KEY', 'E2B_API_KEY', 'RUN']:
            if key in os.environ:
                del os.environ[key]

        # Load environment variables from the canonical .env location
        env_path = Path(__file__).resolve().parents[2] / '.env'
        load_dotenv(env_path, override=True)

    """Validate required environment variables are set."""
    required_vars = ["BUCKET_NAME", "OPENAI_API_KEY", "E2B_API_KEY", "RUN"]
    
    missing = [var for var in required_vars if not os.environ.get(var)]
    if missing:
        raise ValueError(f"Missing required environment variables: {missing}")