import logging
import json
import os
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import hashlib
from fastapi import Request

# Configure logging for Cloud Run
def setup_logging():
    """Configure logging optimized for Google Cloud Run."""
    # Cloud Run automatically captures stdout/stderr, so we use structured logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(message)s',  # Cloud Run handles timestamps
        handlers=[logging.StreamHandler()]
    )
    
    # Set specific loggers to appropriate levels
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)  # Reduce noise
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)

# Initialize logging
setup_logging()
logger = logging.getLogger(__name__)

def _hash_value(value: str) -> str:
    """Return a short, non-reversible hash for identifiers (e.g., IPs, request IDs)."""
    if not value:
        return ""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]

def _sanitize_headers(request: Request) -> Dict[str, Optional[str]]:
    """
    Return a minimal, sanitized subset of headers without potentially sensitive data.
    - Redacts full IP chains, referers, and user agents to reduce PII exposure.
    - Does NOT include any auth or cookie headers.
    """
    return {
        # Keep only presence/length hints rather than full values
        "x-forwarded-for": "present" if request.headers.get("x-forwarded-for") else None,
        "x-real-ip": "present" if request.headers.get("x-real-ip") else None,
        "referer": "present" if request.headers.get("referer") else None,
        "x-cloud-trace-context": request.headers.get("x-cloud-trace-context", None),
    }

def log_security_event(
    event_type: str, 
    request: Request, 
    details: Optional[Dict[str, Any]] = None,
    severity: str = "INFO"
):
    """
    Log security events with structured data for monitoring and alerting.
    Optimized for Google Cloud Run logging.
    
    Args:
        event_type: Type of security event (e.g., 'auth_failure', 'rate_limit_exceeded')
        request: FastAPI Request object
        details: Additional event details
        severity: Log level (INFO, WARNING, ERROR, CRITICAL)
    """
    # Get Cloud Run metadata
    service_name = os.environ.get("K_SERVICE", "")
    revision_name = os.environ.get("K_REVISION", "")
    region = os.environ.get("K_REGION", "")
    
    log_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "severity": severity,
        "service": service_name,
        "revision": revision_name,
        "region": region,
        "event_type": event_type,
        "request_id": _hash_value(getattr(request.state, 'request_id', '') or ''),
        "client_ip_hash": _hash_value(request.client.host) if request.client else "",
        "method": request.method,
        # Avoid logging full URL with query; only path is included to limit data leakage
        "path": request.url.path,
        "headers": _sanitize_headers(request),
        "details": details or {}
    }
    
    # Log based on severity
    log_message = json.dumps(log_entry)
    if severity == "CRITICAL":
        logger.critical(log_message)
    elif severity == "ERROR":
        logger.error(log_message)
    elif severity == "WARNING":
        logger.warning(log_message)
    else:
        logger.info(log_message)

def log_auth_failure(request: Request, reason: str = "invalid_secret"):
    """Log authentication failures."""
    log_security_event(
        event_type="auth_failure",
        request=request,
        details={"reason": reason},
        severity="WARNING"
    )

def log_rate_limit_exceeded(request: Request, limit: str):
    """Log rate limit violations."""
    log_security_event(
        event_type="rate_limit_exceeded",
        request=request,
        details={"limit": limit},
        severity="WARNING"
    )

def log_download_request(request: Request, file_type: str):
    """Log successful download requests."""
    log_security_event(
        event_type="download_request",
        request=request,
        details={"file_type": file_type},
        severity="INFO"
    )

def log_error(request: Request, error_type: str, error_message: str):
    """Log application errors."""
    log_security_event(
        event_type="application_error",
        request=request,
        details={
            "error_type": error_type,
            "error_message": error_message
        },
        severity="ERROR"
    )
