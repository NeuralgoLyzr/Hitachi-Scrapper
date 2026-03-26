from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "contact_enrich"
    jwt_secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 30
    lyzr_api_key: str = "sk-default-3hA6fxmQvbblKvUApwxLV6eVd3SeOi0C"
    lyzr_user_id: str = "ayushmaan@lyzr.ai"
    lyzr_industry_classification_agent_id: str = "69c18257661c00f324c33503"
    lyzr_agent_research_domain_id: str = "69c186dd328a295d3f3a5c35"
    lyzr_batch_concurrency: int = 3
    lyzr_http_timeout_seconds: int = 180
    lyzr_http_retries: int = 3
    lyzr_http_retry_backoff_seconds: float = 5.0
    apollo_api_key: str = "GGftjAMOr7fiIhD375eirw"
    apollo_base_url: str = "https://api.apollo.io/v1"
    cors_origins: str = "http://localhost:3333"
    lyzr_inference_url: str = "https://agent-prod.studio.lyzr.ai/v3/inference/chat/"


settings = Settings()
