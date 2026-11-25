"""Search by meaning: on-device text embeddings with EmbeddingGemma 2, run through llama.cpp.

Off until the user turns it on and picks a model. It embeds the same ``extracted_text`` the keyword
index searches, one vector per file, and adds files that match a search by meaning after the ones
that match its words.
"""
