"""业务知识检索（RAG）：TF-IDF 向量化 + 余弦相似度。

比原来的「2-gram 重叠计数」稳定：同一个问题换种说法也能命中，
并且返回可展示的引用来源（文档标题 / 小节 / 相似度）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.core.config import KNOWLEDGE_DIR

_SENTENCE_SPLIT = re.compile(r"[\n。；;！!？?]+")


@dataclass(frozen=True)
class Chunk:
    doc_title: str
    slug: str
    section: str
    text: str


def _parse_document(path: Path) -> tuple[str, list[Chunk]]:
    raw = path.read_text(encoding="utf-8")
    title = path.stem
    for line in raw.splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            break

    chunks: list[Chunk] = []
    section = "概述"
    buffer: list[str] = []

    def flush() -> None:
        text = "".join(buffer).strip()
        if text:
            chunks.append(Chunk(doc_title=title, slug=path.stem, section=section, text=text))
        buffer.clear()

    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            flush()
            section = stripped.lstrip("#").strip() or section
            continue
        if not stripped:
            continue
        buffer.append(stripped + " ")
        if len("".join(buffer)) > 220:
            flush()
    flush()
    return title, chunks


@lru_cache(maxsize=1)
def _corpus() -> tuple[Chunk, ...]:
    if not KNOWLEDGE_DIR.exists():
        return ()
    chunks: list[Chunk] = []
    for path in sorted(KNOWLEDGE_DIR.glob("*.md")):
        _, doc_chunks = _parse_document(path)
        chunks.extend(doc_chunks)
    return tuple(chunks)


@lru_cache(maxsize=1)
def _index():
    """构建 TF-IDF 矩阵（字符 2~3 gram，对中文友好）。"""
    from sklearn.feature_extraction.text import TfidfVectorizer

    chunks = _corpus()
    if not chunks:
        return None, None, chunks
    docs = [f"{c.doc_title} {c.section} {c.text}" for c in chunks]
    vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(2, 3), min_df=1)
    matrix = vectorizer.fit_transform(docs)
    return vectorizer, matrix, chunks


def reload_knowledge() -> int:
    """清空缓存并重新加载（改完文档后调用）。"""
    _corpus.cache_clear()
    _index.cache_clear()
    return len(_corpus())


def document_titles() -> list[str]:
    seen: list[str] = []
    for chunk in _corpus():
        if chunk.doc_title not in seen:
            seen.append(chunk.doc_title)
    return seen


def documents() -> list[dict]:
    """知识库文档清单。"""
    stats: dict[str, dict] = {}
    for chunk in _corpus():
        item = stats.setdefault(
            chunk.slug,
            {"slug": chunk.slug, "title": chunk.doc_title, "sections": set(), "chars": 0},
        )
        item["sections"].add(chunk.section)
        item["chars"] += len(chunk.text)
    result = [
        {
            "slug": item["slug"],
            "title": item["title"],
            "section_count": len(item["sections"]),
            "chars": item["chars"],
        }
        for item in stats.values()
    ]
    result.sort(key=lambda row: row["title"])
    return result


def search_knowledge(query: str, top_k: int = 3) -> list[dict]:
    """返回 [{title, section, content, score, slug}]，按相似度降序。"""
    query = (query or "").strip()
    if not query:
        return []
    vectorizer, matrix, chunks = _index()
    if vectorizer is None or matrix is None:
        return []

    from sklearn.metrics.pairwise import cosine_similarity

    query_vec = vectorizer.transform([query])
    scores = cosine_similarity(query_vec, matrix)[0]
    ranked = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)

    hits: list[dict] = []
    for index in ranked[: max(top_k * 2, top_k)]:
        score = float(scores[index])
        if score <= 0:
            continue
        chunk = chunks[index]
        hits.append(
            {
                "title": chunk.doc_title,
                "section": chunk.section,
                "slug": chunk.slug,
                "content": chunk.text.strip(),
                "score": round(score, 4),
            }
        )
        if len(hits) >= top_k:
            break
    return hits


def save_document(filename: str, content: str) -> dict:
    """新增/覆盖一篇知识文档（md / txt 都存成 .md）。"""
    from app.core.errors import AppError

    stem = Path(filename or "knowledge").stem.strip() or "knowledge"
    stem = re.sub(r"[^\w\u4e00-\u9fa5-]+", "_", stem)[:60] or "knowledge"
    if not content.strip():
        raise AppError("文档内容为空", code="KNOWLEDGE_EMPTY", status_code=400)
    if len(content) > 200_000:
        raise AppError("文档过大（上限 200KB）", code="KNOWLEDGE_TOO_LARGE", status_code=400)

    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    path = KNOWLEDGE_DIR / f"{stem}.md"
    path.write_text(content, encoding="utf-8")
    count = reload_knowledge()
    return {"slug": stem, "chars": len(content), "chunks": count}


__all__ = [
    "Chunk",
    "documents",
    "document_titles",
    "reload_knowledge",
    "save_document",
    "search_knowledge",
]
