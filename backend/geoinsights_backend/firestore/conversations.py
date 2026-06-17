from google.cloud import firestore
from geoinsights_backend.firestore.client import FIRESTORE_DB
from geoinsights_backend.services.llm import create_title_from_messages
import json
import logging

logger = logging.getLogger(__name__)

def create_new_conversation(user_id,messages):

    title = create_title_from_messages(messages)

    conv_ref = FIRESTORE_DB.collection("conversations").document()

    conv_ref.set({
        "title":title,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
        "userId": user_id
    })

    return conv_ref.id


def add_message_to_conversation(message):

    conversation_id = message['conversation_id']

    FIRESTORE_DB.collection("conversations") \
        .document(conversation_id) \
        .collection("messages") \
        .add({
            "role": message['role'],
            "content": message['content'],
            "createdAt": firestore.SERVER_TIMESTAMP,
            "figures": [json.dumps(fig) for fig in message['figures']],
            "tables": [json.dumps(table) for table in message['tables']],
            "otherResults": message['other_results'],
            "code": message['code'],
            "responseType": message['response_type']
        })


def update_conversation_title(conversation_id,new_title):

    FIRESTORE_DB.collection("conversations").document(conversation_id).update({
        "title": new_title,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })


def delete_conversation(conversation_id):

    FIRESTORE_DB.recursive_delete(
        FIRESTORE_DB.collection("conversations").document(conversation_id)
    )


def get_all_conversations(user_id):

    docs = FIRESTORE_DB.collection("conversations").where("userId", "==", user_id).stream()

    conversations = []

    for doc in docs:
        conversation = doc.to_dict()
        conversations.append({
            'id': doc.id,
            'title': conversation['title'],
            'createdAt': conversation['createdAt'],
            'updatedAt': conversation['updatedAt'],
            'userId': conversation['userId']
        })

    return conversations


def get_conversation_by_id(conversation_id):

    docs = FIRESTORE_DB.collection("conversations").document(conversation_id).collection("messages").stream()

    messages = []

    for doc in docs:
        message = doc.to_dict()

        if 'figures' in message.keys():
            message['figures'] = [json.loads(fig) for fig in message['figures']]
        if 'tables' in message.keys():
            message['tables'] = [json.loads(table) for table in message['tables']]
        if 'other_results' in message.keys():
            message['other_results'] = [json.loads(result) for result in message['other_results']]

        messages.append(message)

    return messages