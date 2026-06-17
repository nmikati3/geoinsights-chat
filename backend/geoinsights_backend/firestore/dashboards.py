from google.cloud import firestore
from geoinsights_backend.firestore.client import FIRESTORE_DB
from geoinsights_backend.services.e2b import run_code_and_get_results
from geoinsights_backend.services.initialize import DATASETS
import logging

logger = logging.getLogger(__name__)


def create_new_dashboard(user_id,title):

    dashboard_ref = FIRESTORE_DB.collection("dashboards").document()

    dashboard_ref.set({
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
        "userId": user_id,
        "title":title
    })

    return dashboard_ref.id


def add_figure_to_dashboard(figure):

    # Validate required fields
    required_fields = ['dashboard_id', 'code', 'title', 'x', 'y', 'width', 'height']
    missing_fields = [field for field in required_fields if field not in figure]
    if missing_fields:
        raise ValueError(f"Missing required fields: {', '.join(missing_fields)}")

    dashboard_id = figure['dashboard_id']

    # Use .get() for optional fields (figure and table can be None)
    figure_data = {
        "code": figure['code'] if figure['code'] else "",
        "title": figure['title'],
        "figure": figure.get('figure') if figure.get('figure') else "",
        "table": figure.get('table') if figure.get('table') else "",
        "x": figure['x'],
        "y": figure['y'],
        "width": figure['width'],
        "height": figure['height'],
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
        "dataset": figure['dataset']
    }

    FIRESTORE_DB.collection("dashboards") \
        .document(dashboard_id) \
        .collection("figures") \
        .add(figure_data)


def remove_figure_from_dashboard(dashboard_id,figure_id):

    FIRESTORE_DB.collection("dashboards").document(dashboard_id).collection("figures").document(figure_id).delete()


def update_dashboard_title(dashboard_id,new_title):

    updates = {}
    updates["updatedAt"] = firestore.SERVER_TIMESTAMP
    updates["title"] = new_title

    FIRESTORE_DB.collection("dashboards").document(dashboard_id).update(updates)


def update_figure(dashboard_id,figure_id,new_information):

    updates = {}
    updates["updatedAt"] = firestore.SERVER_TIMESTAMP

    new_title = new_information.get("title")
    new_figure = new_information.get("figure")
    new_table = new_information.get("table")
    x = new_information.get("x")
    y = new_information.get("y")
    width = new_information.get("width")
    height = new_information.get("height")
    new_code = new_information.get("code")
    new_dataset = new_information.get("dataset")

    if new_title:
        updates["title"] = new_title
    if new_figure:
        updates["figure"] = new_figure
    if new_table:
        updates["table"] = new_table
    if x:
        updates["x"] = x
    if y:
        updates["y"] = y
    if width:
        updates["width"] = width
    if height:
        updates["height"] = height
    if new_code:
        updates["code"] = new_code
    if new_dataset:
        updates["dataset"] = new_dataset

    FIRESTORE_DB.collection("dashboards").document(dashboard_id).collection("figures").document(figure_id).update(updates)


def delete_dashboard(dashboard_id):

    FIRESTORE_DB.recursive_delete(
        FIRESTORE_DB.collection("dashboards").document(dashboard_id)
    )


def get_all_dashboards(user_id):

    docs = FIRESTORE_DB.collection("dashboards").where("userId", "==", user_id).stream()

    dashboards = []

    for doc in docs:
        dashboard = doc.to_dict()
        dashboards.append({
            'id': doc.id,
            'title': dashboard['title'],
            'createdAt': dashboard['createdAt'],
            'updatedAt': dashboard['updatedAt'],
            'userId': dashboard['userId']
        })

    return dashboards


def get_dashboard_by_id(dashboard_id):

    docs = FIRESTORE_DB.collection("dashboards").document(dashboard_id).collection("figures").stream()

    figures = []

    for doc in docs:
        figure = doc.to_dict()
        figure['dashboard_id'] = dashboard_id
        figure['figure_id'] = doc.id

        code = figure['code']
        dataset = figure.get('dataset')

        if dataset not in DATASETS.keys():
            figures.append(figure)

        else:
            results = run_code_and_get_results(code,dataset)

            created_figures = results.get("figures", [])
            if len(created_figures) > 0:
                figure['figure'] = created_figures[0]

            created_tables = results.get("tables", [])
            if len(created_tables) > 0:
                figure['table'] = created_tables[0]

            figures.append(figure)

    return figures