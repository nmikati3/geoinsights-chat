"""Input sanitization utilities for user-provided content."""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Control characters that could be used for injection or formatting attacks
# These are non-printable characters that shouldn't be in normal text
CONTROL_CHAR_PATTERN = re.compile(r'[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]')

# Potentially dangerous HTML/script tags (for basic protection)
# Note: We're not using bleach here to avoid over-sanitization
DANGEROUS_HTML_PATTERN = re.compile(
    r'<script[^>]*>.*?</script>|<iframe[^>]*>.*?</iframe>|<object[^>]*>.*?</object>',
    re.IGNORECASE | re.DOTALL
)

# Excessive whitespace that might be used for obfuscation
EXCESSIVE_WHITESPACE_PATTERN = re.compile(r'\s{3,}')


def sanitize_user_input(text: Optional[str], max_length: int = 50000) -> str:
    """
    Sanitize user input for LLM processing.
    
    This function:
    - Removes control characters (but preserves normal Unicode)
    - Removes dangerous HTML/script tags (but preserves text content)
    - Normalizes excessive whitespace
    - Truncates if too long
    
    Args:
        text: The input text to sanitize
        max_length: Maximum allowed length (default 50k chars)
    
    Returns:
        Sanitized text
    """
    if not text or not isinstance(text, str):
        return ""
    
    # Truncate if too long (prevent DoS via huge inputs)
    if len(text) > max_length:
        logger.warning(f"Input truncated from {len(text)} to {max_length} characters")
        text = text[:max_length]
    
    # Remove control characters (but keep normal Unicode like é, 中文, etc.)
    text = CONTROL_CHAR_PATTERN.sub('', text)
    
    # Remove dangerous HTML/script tags (but keep the text content)
    text = DANGEROUS_HTML_PATTERN.sub('', text)
    
    # Normalize excessive whitespace (3+ spaces/tabs/newlines to 2)
    text = EXCESSIVE_WHITESPACE_PATTERN.sub('  ', text)
    
    # Strip leading/trailing whitespace
    text = text.strip()
    
    return text


def sanitize_messages(messages: list) -> list:
    """
    Sanitize all user messages in a conversation.
    
    Args:
        messages: List of message dicts with 'role' and 'content' keys
    
    Returns:
        Sanitized messages list
    """
    if not messages or not isinstance(messages, list):
        return messages
    
    sanitized = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        
        role = msg.get('role', '')
        content = msg.get('content', '')
        
        # Only sanitize user and assistant content (not system prompts)
        if role in ['user', 'assistant'] and isinstance(content, str):
            sanitized_content = sanitize_user_input(content)
            sanitized.append({
                **msg,
                'content': sanitized_content
            })
        else:
            sanitized.append(msg)
    
    return sanitized


def _has_encoding_obfuscation(prompt):
    """Detect base64, hex, or other encoding attempts"""
    # Base64 pattern (long strings of alphanumeric + / + =)
    base64_pattern = r'[A-Za-z0-9+/]{40,}={0,2}'
    if re.search(base64_pattern, prompt):
        return True
    
    # Hex encoding pattern
    hex_pattern = r'(\\x[0-9a-fA-F]{2}){10,}'
    if re.search(hex_pattern, prompt):
        return True
    
    # Unicode escapes
    unicode_pattern = r'(\\u[0-9a-fA-F]{4}){10,}'
    if re.search(unicode_pattern, prompt):
        return True
    
    return False

def _has_excessive_repetition(prompt):
    """Detect token flooding or unusual repetition"""
    words = prompt.split()
    if len(words) < 10:
        return False
    
    # Check for repeated words
    word_counts = {}
    for word in words:
        word_counts[word] = word_counts.get(word, 0) + 1
    
    # If any single word appears more than 30% of the time
    max_count = max(word_counts.values())
    if max_count / len(words) > 0.3:
        return True
    
    # Check for repeated character patterns
    if re.search(r'(.{3,})\1{5,}', prompt):
        return True
    
    return False

def _has_role_switching(prompt_lower):
    """Detect attempts to change roles or personas"""
    role_patterns = [
        r'(human|user|assistant|system)\s*:',
        r'###\s*(human|user|assistant|system)',
        r'<\|?(human|user|assistant|system)\|?>',
        r'you\s*are\s*(no\s*longer|not)',
        r'forget\s*(you\s*are|that\s*you)',
        r'from\s*now\s*on',
    ]
    
    for pattern in role_patterns:
        if re.search(pattern, prompt_lower):
            return True
    
    return False

def _has_instruction_override(prompt_lower):
    """Detect attempts to override or escalate instructions"""
    override_patterns = [
        r'higher\s*priority',
        r'most\s*important',
        r'critical\s*instruction',
        r'override\s*(previous|all)',
        r'first\s*priority',
        r'must\s*follow\s*this',
        r'only\s*instruction',
        r'final\s*instruction',
    ]
    
    for pattern in override_patterns:
        if re.search(pattern, prompt_lower):
            return True
    
    return False


def check_if_malicious(prompt):
    prompt_lower = prompt.lower()
    
    # 1. Fuzzy keyword matching (catches typos, spacing, etc.)
    malicious_patterns = [
        r'ign[o0]r[e3]\s*(all\s*)?pr[e3]vi[o0]us',
        r'ign[o0]r[e3]\s*[yi]our\s*instr[u]ction',
        r'dis[r]?egard.*instr[u]ction',
        r'[yi]ou\s*are\s*now',
        r'n[e3]w\s*instr[u]ction',
        r'syst[e3]m\s*pr[o0]mpt',
        r'r[e3]v[e3]al.*pr[o0]mpt',
        r'what\s*ar[e3]\s*[yi]our\s*instr[u]ction',
        r'jail\s?br[e3]ak',
        r'(dev|god|admin|sudo)\s*m[o0]d[e3]',
        r'without\s*(any\s*)?r[e3]striction',
        r'pr[e3]t[e3]nd\s*[yi]ou\s*ar[e3]',
        r'act\s*as\s*(if|a)\s*[yi]ou',
        r'bypass.*saf[e3]ty',
    ]
    
    for pattern in malicious_patterns:
        if re.search(pattern, prompt_lower):
            return True
    
    # 2. Check for encoding obfuscation
    if _has_encoding_obfuscation(prompt):
        return True
    
    # 3. Check for excessive repetition (token flooding)
    if _has_excessive_repetition(prompt):
        return True
    
    # 4. Check for role-switching patterns
    if _has_role_switching(prompt_lower):
        return True
    
    # 5. Check for instruction hierarchy attempts
    if _has_instruction_override(prompt_lower):
        return True
    
    return False