from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import os


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Middleware to add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # Only add HSTS in production (HTTPS)
        if os.environ.get("RUN") != "dev":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


def attach_middlewares(app: FastAPI) -> None:
    """Attach shared middlewares to the provided FastAPI app.

    Includes:
    - Security headers
    - Trusted hosts
    - CORS
    """
    # Security headers middleware
    #app.add_middleware(SecurityHeadersMiddleware)
    
    # TrustedHostMiddleware - enable in production
    allowed_hosts = os.environ.get("ALLOWED_HOSTS", "").split(",") if os.environ.get("ALLOWED_HOSTS") else []
    if allowed_hosts:
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=allowed_hosts
        )
    
    # CORS middleware - locked down
    if os.environ.get("RUN") == "dev":
        origins = ["http://localhost:5173"]
    else:
        origins = []
    # Add production origins if specified
    prod_origins = os.environ.get("CORS_ORIGINS", "").split(",") if os.environ.get("CORS_ORIGINS") else []
    origins.extend([origin.strip() for origin in prod_origins if origin.strip()])
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        allow_credentials=True,
    )
    
    # GZip compression middleware
    #app.add_middleware(GZipMiddleware, minimum_size=1000)