import os
import json
import logging
import asyncio
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import PlainTextResponse, StreamingResponse
from geoinsights_backend.services import initialize
from geoinsights_backend.services.initialize import initialize_sandbox
from geoinsights_backend.services.responses import ( 
    get_text_response, 
    get_search_response, 
    generate_quantitative_response, 
    generate_figure_response
)
from geoinsights_backend.services.datasets.custom_behaviors import world_map
from geoinsights_backend.services.deep_research.deep_research import deep_research_workflow
from geoinsights_backend.auth.authorization import (
    require_user,
    authorize_conversation_by_id,
    authorize_dashboard_by_id
)
from slowapi import Limiter
from geoinsights_backend.core.sanitization import sanitize_messages
from geoinsights_backend.firestore.conversations import (
    create_new_conversation,
    add_message_to_conversation,
    update_conversation_title,
    delete_conversation,
    get_all_conversations,
    get_conversation_by_id
)
from geoinsights_backend.firestore.dashboards import (
    create_new_dashboard,
    add_figure_to_dashboard,
    delete_dashboard,
    get_all_dashboards,
    get_dashboard_by_id,
    remove_figure_from_dashboard,
    update_figure,
    update_dashboard_title
)
from geoinsights_backend.core.sanitization import check_if_malicious


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
# Ensure the logger has a handler (in case logging wasn't configured yet)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(handler)


RUN = os.environ.get("RUN", "")

router = APIRouter()

# Rate limiter will be set from app state
limiter: Limiter = None  # type: ignore

def set_limiter(limiter_instance: Limiter):
    """Set the limiter instance for use in route decorators."""
    global limiter
    limiter = limiter_instance

def rate_limit_decorator(limit: str):
    """
    Create a rate limit decorator that applies slowapi rate limiting.
    
    This decorator will apply the rate limit when the limiter is available.
    The limiter is accessed from request.app.state.limiter at runtime.
    """
    def decorator(func):
        # Apply the limiter decorator if limiter is available
        # Otherwise, return the function as-is (will be re-wrapped after limiter is set)
        if limiter:
            return limiter.limit(limit)(func)
        # Store the limit for later application
        func._rate_limit = limit
        return func
    return decorator

@router.get("/", include_in_schema=False)
def root():
    return {
        "message": "Global GeoInsights API - Global Cybersecurity Data Access",
        "description": "Access comprehensive global cyberattack reports and incident data through JSON files",
    }


@router.get("/healthz", include_in_schema=False)
def healthz(): return PlainTextResponse("ok")


@router.get("/sandbox_running")
def sandbox_running(request: Request):
    return {"running": initialize.is_running()}


@rate_limit_decorator("5/minute")
@router.post("/start_sandbox")
async def start_sandbox(request: Request, user_id: str = Depends(require_user)):
    """Start/initialize the sandbox."""
    try:
        for dataset in initialize.DATASETS.keys():
            if initialize.DATASETS[dataset]['DATA'] is None:
                raise HTTPException(status_code=400, detail=f"{dataset} data not loaded. Please ensure data is initialized first.")
        
        logger.info("Starting sandbox via /start_sandbox endpoint...")
        initialize_sandbox()
        logger.info(f"Sandboxes started successfully")
        
        return {
            "status": "success",
            "message": "Sandboxes initialized successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to initialize sandbox: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/datasets")
async def datasets(request: Request):
    return {"datasets": list(initialize.DATASETS.keys())}
    

@rate_limit_decorator("30/minute")
@router.post("/stream_text_response")
async def stream_text_response(request: Request, user_id: str = Depends(require_user)):
    data = await request.json()
    messages = data.get("messages")
    search = data.get("search", False)
    dataset = data.get("dataset")
    
    # Validate dataset parameter
    if dataset and dataset not in initialize.DATASETS:
        raise HTTPException(status_code=400, detail="Invalid dataset")
    
    # Sanitize user input
    if messages:
        messages = sanitize_messages(messages)
    
    # Server-side malicious prompt check
    if messages:
        last_user_message = next((msg for msg in reversed(messages) if msg.get("role") == "user"), None)
        if last_user_message:
            prompt = last_user_message.get("content", "")
            if prompt and check_if_malicious(prompt):
                raise HTTPException(status_code=400, detail="Request contains potentially malicious content")

    def response_generator():
        try:
            if search:
                for chunk in get_search_response(messages):
                    yield chunk
            else:
                for chunk in get_text_response(messages,dataset):
                    yield chunk
        except Exception as e:
            logger.error(f"Error in stream_text_response generator: {e}", exc_info=True)
            yield f"\n\n[Error: An unexpected error occurred]"

    return StreamingResponse(response_generator(), media_type="text/plain")


@rate_limit_decorator("30/minute")
@router.post("/text_response")
async def text_response(request: Request, user_id: str = Depends(require_user)):
    data = await request.json()
    messages = data.get("messages")
    search = data.get("search", False)
    dataset = data.get("dataset")
    
    # Validate dataset parameter
    if dataset and dataset not in initialize.DATASETS:
        raise HTTPException(status_code=400, detail="Invalid dataset")
    
    # Sanitize user input
    if messages:
        messages = sanitize_messages(messages)
    
    # Server-side malicious prompt check
    if messages:
        last_user_message = next((msg for msg in reversed(messages) if msg.get("role") == "user"), None)
        if last_user_message:
            prompt = last_user_message.get("content", "")
            if prompt and check_if_malicious(prompt):
                raise HTTPException(status_code=400, detail="Request contains potentially malicious content")

    if search:
        response = get_search_response(messages)
    else:
        response = get_text_response(messages,dataset)

    return {"text": response, "objects": [], "object_types": [], "response_type": 'text'}


@rate_limit_decorator("20/minute")
@router.post("/world_map_response")
async def world_map_response(request: Request, user_id: str = Depends(require_user)):
    data = await request.json()
    messages = data.get("messages")
    response_type = data.get("response_type")
    
    # Sanitize user input
    if messages:
        messages = sanitize_messages(messages)
    
    # Server-side malicious prompt check
    if messages:
        last_user_message = next((msg for msg in reversed(messages) if msg.get("role") == "user"), None)
        if last_user_message:
            prompt = last_user_message.get("content", "")
            if prompt and check_if_malicious(prompt):
                raise HTTPException(status_code=400, detail="Request contains potentially malicious content")
    
    fig = world_map(messages,response_type)
    return {"text": '', "objects": [fig], "object_types": ['world map'], "response_type": 'code'}



@rate_limit_decorator("10/minute")
@router.post("/stream_quantitative_response")
async def stream_quantitative_response(request: Request, user_id: str = Depends(require_user)):
    """
    Streams quantitative analysis response using Server-Sent Events (SSE).
    
    Format:
    - First event: metadata with figures and tables as JSON
    - Subsequent events: text chunks from LLM response
    
    Frontend can use EventSource API to consume this stream.
    """
    data = await request.json()
    messages = data.get("messages")
    dataset = data.get("dataset")
    
    # Validate dataset parameter
    if dataset and dataset not in initialize.DATASETS:
        raise HTTPException(status_code=400, detail="Invalid dataset")
    
    # Sanitize user input
    if messages:
        messages = sanitize_messages(messages)
    
    # Server-side malicious prompt check
    if messages:
        last_user_message = next((msg for msg in reversed(messages) if msg.get("role") == "user"), None)
        if last_user_message:
            prompt = last_user_message.get("content", "")
            if prompt and check_if_malicious(prompt):
                raise HTTPException(status_code=400, detail="Request contains potentially malicious content")
    
    def response_generator():
        try:
            results, response_generator = generate_quantitative_response(messages,dataset)
            
            # First, send metadata (figures and tables) as JSON
            metadata = {
                "type": "metadata",
                "figures": results.get("figures", []),
                "tables": results.get("tables", []),
                "other_results": results.get("other_results", []),
                'code': results.get("code", "")
            }
            yield f"data: {json.dumps(metadata)}\n\n"
            
            # Then, stream the text response
            for chunk in response_generator:
                # json.dumps will handle escaping automatically
                yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
            
            # Send completion signal
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            
        except Exception as e:
            logger.error(f"Error in stream_quantitative_response generator: {e}", exc_info=True)
            error_msg = json.dumps({"type": "error", "message": "An unexpected error occurred"})
            yield f"data: {error_msg}\n\n"
    
    return StreamingResponse(
        response_generator(),
        media_type="text/event-stream",
    )


@rate_limit_decorator("10/minute")
@router.post("/figure_response")
async def figure_response(request: Request, user_id: str = Depends(require_user)):
    data = await request.json()
    messages = data.get("messages")
    dataset = data.get("dataset")
    
    # Validate dataset parameter
    if dataset and dataset not in initialize.DATASETS:
        raise HTTPException(status_code=400, detail="Invalid dataset")
    
    # Sanitize user input
    if messages:
        messages = sanitize_messages(messages)
    
    # Server-side malicious prompt check
    if messages:
        last_user_message = next((msg for msg in reversed(messages) if msg.get("role") == "user"), None)
        if last_user_message:
            prompt = last_user_message.get("content", "")
            if prompt and check_if_malicious(prompt):
                raise HTTPException(status_code=400, detail="Request contains potentially malicious content")
    
    results = generate_figure_response(messages,dataset)
    response = {
        "figures": results.get("figures", []),
        "tables": results.get("tables", []),
        "other_results": results.get("other_results", []),
        'code': results.get("code", "")
    }
    return response


@rate_limit_decorator("5/minute")
@router.post("/deep_research_response")
async def deep_research_response(request: Request, user_id: str = Depends(require_user)):
    data = await request.json()
    messages = data.get("messages")
    dataset = data.get("dataset")

    if not messages:
        raise HTTPException(status_code=400, detail="Messages are required")
    
    # Validate dataset parameter
    if dataset and dataset not in initialize.DATASETS:
        raise HTTPException(status_code=400, detail="Invalid dataset")
    
    # Sanitize user input
    messages = sanitize_messages(messages)
    
    # Server-side malicious prompt check
    last_user_message = next((msg for msg in reversed(messages) if msg.get("role") == "user"), None)
    if last_user_message:
        prompt = last_user_message.get("content", "")
        if prompt and check_if_malicious(prompt):
            raise HTTPException(status_code=400, detail="Request contains potentially malicious content")

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        done = asyncio.Event()
        result_container = {}
        loop = asyncio.get_running_loop()

        def progress_callback(msg: str):
            if msg:
                asyncio.run_coroutine_threadsafe(
                    queue.put({"type": "progress", "content": str(msg)}),
                    loop,
                )

        def run_workflow_sync():
            try:
                progress_callback("🚀 Starting deep research workflow...")
                result = asyncio.run(
                    deep_research_workflow(
                        messages,
                        dataset,
                        progress_callback=progress_callback,
                    )
                )
                result_container["result"] = result
            except Exception as e:
                logger.error(f"Error in deep_research_response workflow: {e}", exc_info=True)
                result_container["result"] = {"error": "An unexpected error occurred"}
                progress_callback(f"❌ Error: An unexpected error occurred")
            finally:
                # Use call_soon_threadsafe for synchronous operations like Event.set()
                loop.call_soon_threadsafe(done.set)

        # Run research in background thread
        asyncio.create_task(asyncio.to_thread(run_workflow_sync))

        # Stream progress
        while not done.is_set() or not queue.empty():
            try:
                item = await asyncio.wait_for(queue.get(), timeout=0.1)
                yield f"data: {json.dumps(item)}\n\n"
            except asyncio.TimeoutError:
                pass

        result = result_container.get("result", {})

        # Final payload
        if result.get("clarification_question"):
            yield f"data: {json.dumps({'type': 'clarification_question', 'clarification_question': result['clarification_question']})}\n\n"
        elif result.get("final_report"):
            yield f"data: {json.dumps({'type': 'final_report', 'final_report': result['final_report']})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'message', 'error': result.get('error')})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/create_conversation")
async def create_conversation(request: Request, user_id: str = Depends(require_user)):
    """Create a new conversation for the authenticated user."""
    data = await request.json()
    messages = data.get("messages")
    if not messages:
        raise HTTPException(status_code=400, detail="Messages are required")
    conversation_id = create_new_conversation(user_id, messages)
    message = messages[0]
    message['conversation_id'] = conversation_id
    add_message_to_conversation(message)
    return {"status": "success", "message": "Conversation created successfully", "conversation_id": conversation_id}


@router.post("/add_message_to_conversation")
async def add_message(request: Request, user_id: str = Depends(require_user)):
    """Add a message to a conversation. Verifies the user owns the conversation."""
    message = await request.json()
    conversation_id = message.get("conversation_id")
    if not conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")
    # Verify user owns the conversation
    authorize_conversation_by_id(conversation_id, user_id)
    add_message_to_conversation(message)
    return {"status": "success", "message": "Message added to conversation successfully"}


@router.post("/update_conversation_title")
async def update_title(request: Request, user_id: str = Depends(require_user)):
    """Update conversation title. Verifies the user owns the conversation."""
    data = await request.json()
    conversation_id = data.get("conversation_id")
    new_title = data.get("new_title")
    if not conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")
    if not new_title:
        raise HTTPException(status_code=400, detail="new_title is required")
    # Verify user owns the conversation
    authorize_conversation_by_id(conversation_id, user_id)
    update_conversation_title(conversation_id, new_title)
    return {"status": "success", "message": "Conversation title updated successfully"}


@router.post("/delete_conversation")
async def delete(request: Request, user_id: str = Depends(require_user)):
    """Delete a conversation. Verifies the user owns the conversation."""
    data = await request.json()
    conversation_id = data.get("conversation_id")
    if not conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")
    # Verify user owns the conversation
    authorize_conversation_by_id(conversation_id, user_id)
    delete_conversation(conversation_id)
    return {"status": "success", "message": "Conversation deleted successfully"}


@router.post("/get_all_conversations")
async def all_conversations(request: Request, user_id: str = Depends(require_user)):
    """Get all conversations for the authenticated user."""
    conversations = get_all_conversations(user_id)
    return {"status": "success", "conversations": conversations}


@router.post("/get_conversation_by_id")
async def conversation_by_id(request: Request, user_id: str = Depends(require_user)):
    """Get a conversation by ID. Verifies the user owns the conversation."""
    data = await request.json()
    conversation_id = data.get("conversation_id")
    if not conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")
    # Verify user owns the conversation
    authorize_conversation_by_id(conversation_id, user_id)
    conversation = get_conversation_by_id(conversation_id)
    return {"status": "success", "conversation": conversation}


@router.post("/create_dashboard")
async def create_dashboard(request: Request, user_id: str = Depends(require_user)):
    """Create a new dashboard for the authenticated user."""
    data = await request.json()
    title = data.get("title")
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    dashboard_id = create_new_dashboard(user_id, title)
    return {"status": "success", "message": "Dashboard created successfully", "dashboard_id": dashboard_id}


@router.post("/add_figure_to_dashboard")
async def add_figure(request: Request, user_id: str = Depends(require_user)):
    """Add a figure to a dashboard. Verifies the user owns the dashboard."""
    try:
        figure = await request.json()
        dashboard_id = figure.get("dashboard_id")
        if not dashboard_id:
            raise HTTPException(status_code=400, detail="dashboard_id is required")
        # Verify user owns the dashboard
        authorize_dashboard_by_id(dashboard_id, user_id)
        add_figure_to_dashboard(figure)
        return {"status": "success", "message": "Figure added to dashboard successfully"}
    except ValueError as e:
        logger.error(f"Validation error in add_figure_to_dashboard: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError as e:
        logger.error(f"Missing key in add_figure_to_dashboard: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Missing required field: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in add_figure_to_dashboard: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/remove_figure_from_dashboard")
async def remove_figure(request: Request, user_id: str = Depends(require_user)):
    """Remove a figure from a dashboard. Verifies the user owns the dashboard."""
    data = await request.json()
    dashboard_id = data.get("dashboard_id")
    figure_id = data.get("figure_id")
    if not dashboard_id:
        raise HTTPException(status_code=400, detail="dashboard_id is required")
    if not figure_id:
        raise HTTPException(status_code=400, detail="figure_id is required")
    # Verify user owns the dashboard
    authorize_dashboard_by_id(dashboard_id, user_id)
    logger.info(f"Removing figure {figure_id} from dashboard {dashboard_id}")
    remove_figure_from_dashboard(dashboard_id, figure_id)
    return {"status": "success", "message": "Figure removed from dashboard successfully"}


@router.post("/delete_dashboard")
async def delete_dash(request: Request, user_id: str = Depends(require_user)):
    """Delete a dashboard. Verifies the user owns the dashboard."""
    data = await request.json()
    dashboard_id = data.get("dashboard_id")
    if not dashboard_id:
        raise HTTPException(status_code=400, detail="dashboard_id is required")
    # Verify user owns the dashboard
    authorize_dashboard_by_id(dashboard_id, user_id)
    delete_dashboard(dashboard_id)
    return {"status": "success", "message": "Dashboard deleted successfully"}


@router.post("/update_dashboard_title")
async def update_dash_title(request: Request, user_id: str = Depends(require_user)):
    """Update dashboard title. Verifies the user owns the dashboard."""
    data = await request.json()
    dashboard_id = data.get("dashboard_id")
    new_title = data.get("new_title")
    if not dashboard_id:
        raise HTTPException(status_code=400, detail="dashboard_id is required")
    if not new_title:
        raise HTTPException(status_code=400, detail="new_title is required")
    # Verify user owns the dashboard
    authorize_dashboard_by_id(dashboard_id, user_id)
    update_dashboard_title(dashboard_id, new_title)
    return {"status": "success", "message": "Dashboard title updated successfully"}


@router.post("/update_figure")
async def update_fig(request: Request, user_id: str = Depends(require_user)):
    """Update a figure in a dashboard. Verifies the user owns the dashboard."""
    data = await request.json()
    dashboard_id = data.get("dashboard_id")
    figure_id = data.get("figure_id")
    new_information = data.get("new_information")
    if not dashboard_id:
        raise HTTPException(status_code=400, detail="dashboard_id is required")
    if not figure_id:
        raise HTTPException(status_code=400, detail="figure_id is required")
    if not new_information:
        raise HTTPException(status_code=400, detail="new_information is required")
    # Verify user owns the dashboard
    authorize_dashboard_by_id(dashboard_id, user_id)
    update_figure(dashboard_id, figure_id, new_information)
    return {"status": "success", "message": "Figure updated successfully"}


@router.post("/get_all_dashboards")
async def all_dashboards(request: Request, user_id: str = Depends(require_user)):
    """Get all dashboards for the authenticated user."""
    dashboards = get_all_dashboards(user_id)
    return {"status": "success", "dashboards": dashboards}


@router.post("/get_dashboard_by_id")
async def dashboard_by_id(request: Request, user_id: str = Depends(require_user)):
    """Get a dashboard by ID. Verifies the user owns the dashboard."""
    data = await request.json()
    dashboard_id = data.get("dashboard_id")
    if not dashboard_id:
        raise HTTPException(status_code=400, detail="dashboard_id is required")
    # Verify user owns the dashboard
    authorize_dashboard_by_id(dashboard_id, user_id)
    dashboard = get_dashboard_by_id(dashboard_id)
    return {"status": "success", "dashboard": dashboard}