from geoinsights_backend.core.utils import validate_environment
from geoinsights_backend.core.middleware import attach_middlewares

# Validate environment on startup
validate_environment()

import os
# Set OpenMP to single-threaded BEFORE any imports that might use it
# This prevents threading conflicts with FAISS and other libraries on macOS
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
os.environ['NUMEXPR_NUM_THREADS'] = '1'

import logging
from fastapi import FastAPI
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from geoinsights_backend.api import routes
from geoinsights_backend.services.initialize import initialize_data, initialize_sandbox, initialize_reranker

#from geoinsights_backend.core.middleware import attach_middlewares

# Configure logging for local development
# Force reconfiguration if logging was already set up
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()],
    force=True  # Force reconfiguration even if logging was already configured
)

# Set the root logger level
logging.getLogger().setLevel(logging.INFO)

logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="GeoInsights Backend",
    description="Backend for GeoInsights",
    version="1.0.0",
    docs_url="/docs" if os.environ.get("RUN") == "dev" else None,
    redoc_url="/redoc" if os.environ.get("RUN") == "dev" else None
)

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Set limiter in routes module for decorator use
# This must be done before the router is included so decorators can be applied
routes.set_limiter(limiter)

# Re-apply rate limit decorators now that limiter is set
# This ensures functions that were defined before limiter was set get rate limiting applied
for route in routes.router.routes:
    if hasattr(route, 'endpoint'):
        endpoint = route.endpoint
        # Check if endpoint has a rate limit attribute
        if hasattr(endpoint, '_rate_limit'):
            limit = endpoint._rate_limit
            # Re-wrap with rate limiting
            route.endpoint = limiter.limit(limit)(endpoint)

#allowed_hosts = []

attach_middlewares(app)

# Include routes
app.include_router(routes.router)
@app.on_event("startup")
async def startup_event():
    """Load data into memory when the application starts."""
    logger.info("Starting up application...")
    initialize_data()
    initialize_sandbox()
    initialize_reranker()
    logger.info("Application startup complete.")

