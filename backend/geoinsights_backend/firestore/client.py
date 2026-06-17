"""Shared Firestore client for the application."""
from google.cloud import firestore
import os

# Single Firestore client instance shared across the application
FIRESTORE_DB = firestore.Client(
    project=os.environ.get("PROJECT_ID"),
    database=os.environ.get("FIRESTORE_DATABASE")
)
