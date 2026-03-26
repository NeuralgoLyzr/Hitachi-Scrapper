from bson import ObjectId


def normalize_doc(doc: dict | None) -> dict | None:
    if not doc:
        return None
    out = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            out[key] = str(value)
        else:
            out[key] = value
    return out
