from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import auth
import logging
from typing import Dict
from geoinsights_backend.firestore.client import FIRESTORE_DB

logger = logging.getLogger(__name__)

# ---------- Firebase Admin initialization (ADC) ----------

if not firebase_admin._apps:
    firebase_admin.initialize_app()

# ---------- Security scheme ----------

security = HTTPBearer()

# ---------- Authentication (token verification) ----------

async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    Verifies Firebase ID token and returns decoded claims.
    """
    token = credentials.credentials

    try:
        return auth.verify_id_token(token)
    except auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Token expired")
    except auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        logger.exception("Token verification failed")
        raise HTTPException(status_code=401, detail="Authentication failed")


# ---------- Core authorization helper ----------

def _get_owned_resource(
    collection: str,
    resource_id: str,
    uid: str,
) -> Dict:
    """
    Fetch a Firestore document and ensure it belongs to the user.
    """

    doc = FIRESTORE_DB.collection(collection).document(resource_id).get()

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Resource not found")

    data = doc.to_dict()

    if data.get("userId") != uid:
        raise HTTPException(status_code=403, detail="Access denied")

    return data


# ---------- Authorization dependencies ----------

async def authorize_conversation(
    conversation_id: str,
    decoded: dict = Depends(verify_token),
) -> Dict:
    """
    Ensures the authenticated user owns the conversation.
    """
    return _get_owned_resource(
        collection="conversations",
        resource_id=conversation_id,
        uid=decoded["uid"],
    )


async def authorize_dashboard(
    dashboard_id: str,
    decoded: dict = Depends(verify_token),
) -> Dict:
    """
    Ensures the authenticated user owns the dashboard.
    """
    return _get_owned_resource(
        collection="dashboards",
        resource_id=dashboard_id,
        uid=decoded["uid"],
    )


# ---------- Simple identity dependency ----------

async def require_user(
    decoded: dict = Depends(verify_token),
) -> str:
    """
    Returns authenticated user's UID.
    """
    return decoded["uid"]


# ---------- Helper functions for manual authorization (when ID comes from request body) ----------

def authorize_conversation_by_id(conversation_id: str, uid: str) -> Dict:
    """
    Helper function to authorize a conversation when ID comes from request body.
    Returns the conversation data if authorized, raises HTTPException otherwise.
    """
    return _get_owned_resource(
        collection="conversations",
        resource_id=conversation_id,
        uid=uid,
    )


def authorize_dashboard_by_id(dashboard_id: str, uid: str) -> Dict:
    """
    Helper function to authorize a dashboard when ID comes from request body.
    Returns the dashboard data if authorized, raises HTTPException otherwise.
    """
    return _get_owned_resource(
        collection="dashboards",
        resource_id=dashboard_id,
        uid=uid,
    )
