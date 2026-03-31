from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All values come from environment / `.env` (see `.env.example`)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mongodb_url: str
    mongodb_db_name: str
    jwt_secret_key: str
    jwt_algorithm: str
    jwt_expire_minutes: int

    lyzr_api_key: str
    lyzr_user_id: str
    lyzr_industry_classification_agent_id: str
    lyzr_agent_research_domain_id: str
    lyzr_inference_url: str
    lyzr_batch_concurrency: int
    lyzr_http_timeout_seconds: int
    lyzr_http_retries: int
    lyzr_http_retry_backoff_seconds: float

    apollo_api_key: str
    apollo_base_url: str

    cors_origins: str


settings = Settings()
