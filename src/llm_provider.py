import httpx
import keyring
import json
import os
from typing import Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

def save_settings(provider: str, api_key: str, custom_url: Optional[str] = None):
    keyring.set_password("tidyflow", "provider", provider)
    keyring.set_password("tidyflow", "api_key", api_key)
    if custom_url:
        keyring.set_password("tidyflow", "custom_url", custom_url)
    else:
        try:
            keyring.delete_password("tidyflow", "custom_url")
        except keyring.errors.PasswordDeleteError:
            pass

def load_settings() -> tuple:
    # First try keyring, fallback to .env for testing/initial run
    provider = keyring.get_password("tidyflow", "provider")
    api_key = keyring.get_password("tidyflow", "api_key")
    custom_url = keyring.get_password("tidyflow", "custom_url")
    
    if not api_key:
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if api_key:
            provider = "deepseek"
            
    return provider, api_key, custom_url

class LLMProvider:
    def __init__(self, provider: str, api_key: str, custom_url: Optional[str] = None):
        self.provider = provider
        self.api_key = api_key
        self.custom_url = custom_url

    async def test_connection(self) -> bool:
        try:
            res = await self.classify("Test document", is_test=True)
            return "category" in res
        except Exception:
            return False

    async def classify(self, text: str, is_test: bool = False) -> Dict[str, Any]:
        prompt = "Classify this text into a category and suggest a filename. Respond in JSON with keys: category (string), filename (string), confidence (float 0-100). Text: " + text
        if is_test:
            prompt = "Respond with a test JSON: {\"category\": \"test\", \"filename\": \"test.txt\", \"confidence\": 100.0}"
            
        if self.provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key={self.api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"response_mime_type": "application/json"}
            }
            async with httpx.AsyncClient() as client:
                res = await client.post(url, json=payload, timeout=10.0)
                res.raise_for_status()
                data = res.json()
                text_res = data["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text_res)
        else:
            # OpenAI compatible endpoints
            urls = {
                "deepseek": "https://api.deepseek.com/chat/completions",
                "groq": "https://api.groq.com/openai/v1/chat/completions",
                "openrouter": "https://openrouter.ai/api/v1/chat/completions",
                "custom": self.custom_url
            }
            url = urls.get(self.provider)
            if not url:
                raise ValueError(f"Unknown provider: {self.provider}")
                
            models = {
                "deepseek": "deepseek-chat",
                "groq": "llama3-8b-8192",
                "openrouter": "google/gemini-flash-1.5",
                "custom": "default"
            }
            
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": models.get(self.provider, "default"),
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"}
            }
            
            async with httpx.AsyncClient() as client:
                res = await client.post(url, headers=headers, json=payload, timeout=15.0)
                res.raise_for_status()
                data = res.json()
                text_res = data["choices"][0]["message"]["content"]
                
                # Sometime models wrap json in codeblocks
                text_res = text_res.strip()
                if text_res.startswith("```json"):
                    text_res = text_res[7:-3].strip()
                elif text_res.startswith("```"):
                    text_res = text_res[3:-3].strip()
                    
                return json.loads(text_res)
