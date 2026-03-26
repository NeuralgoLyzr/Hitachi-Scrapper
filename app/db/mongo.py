from pymongo import MongoClient
from app.config import settings


client = MongoClient(settings.mongodb_url)
db = client[settings.mongodb_db_name]


def get_collection(name: str):
    return db[name]
