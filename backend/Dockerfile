# Use Python 3.12 slim image as base
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=True
ENV PYTHONPATH=/geoinsights_backend
ENV HF_HOME=/tmp/huggingface
ENV TRANSFORMERS_CACHE=/tmp/huggingface
ENV SENTENCE_TRANSFORMERS_HOME=/tmp/sentence_transformers

WORKDIR /geoinsights_backend

COPY requirements.txt .

# Create user/group early
RUN groupadd -r geoinsights_backend && \
    useradd -r -g geoinsights_backend geoinsights_backend

# Install build dependencies temporarily and fix pip vulnerability
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        gfortran \
        libopenblas-dev \
        liblapack-dev && \
    # Create venv first (with old pip)
    python -m venv ./venv && \
    # Upgrade system pip to fix CVE-2025-8869
    pip install --upgrade pip>=25.3 && \
    # Upgrade venv pip to fix CVE-2025-8869
    ./venv/bin/pip install --upgrade pip>=25.3 setuptools wheel && \
    # Remove the old bundled pip wheel that scanners detect
    rm -f /usr/local/lib/python3.12/ensurepip/_bundled/pip-25.0.1-py3-none-any.whl && \
    # Install dependencies
    ./venv/bin/pip install --no-cache-dir -r requirements.txt && \
    # Clean up build dependencies
    apt-get purge -y --auto-remove gcc g++ gfortran && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --chown=geoinsights_backend:geoinsights_backend . .

USER geoinsights_backend

CMD ["./venv/bin/python", "-m", "uvicorn", "geoinsights_backend.api.main:app", "--host", "0.0.0.0", "--port", "8080"]