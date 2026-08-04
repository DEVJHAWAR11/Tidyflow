import fitz  # PyMuPDF
import pytesseract
from PIL import Image
from typing import Dict, Any

OCR_CONFIDENCE_THRESHOLD = 60.0

def extract_text_from_pdf(pdf_path: str) -> Dict[str, Any]:
    """
    Extracts text from page 1 of a PDF.
    If no text is found, renders the page as an image and uses OCR.
    """
    try:
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            return {"text": "", "confidence": 0.0, "needs_review": True}

        page = doc[0]
        text = page.get_text("text").strip()

        if text and len(text) > 20: # Heuristic for "usable text"
            return {"text": text, "confidence": 100.0, "needs_review": False}

        # Fallback to OCR
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Get OCR data
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        
        extracted_text = []
        confidences = []

        for i, word in enumerate(data['text']):
            if str(word).strip():
                extracted_text.append(str(word))
                conf = data['conf'][i]
                if conf != '-1' and isinstance(conf, (int, float)):
                    confidences.append(float(conf))

        final_text = " ".join(extracted_text).strip()
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

        needs_review = avg_confidence < OCR_CONFIDENCE_THRESHOLD

        return {
            "text": final_text,
            "confidence": avg_confidence,
            "needs_review": needs_review
        }
    except Exception as e:
        return {"text": "", "confidence": 0.0, "needs_review": True, "error": str(e)}
    finally:
        if 'doc' in locals():
            doc.close()

def extract_text_from_image(image_path: str) -> Dict[str, Any]:
    """Extracts text from an image using OCR."""
    try:
        img = Image.open(image_path)
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        
        extracted_text = []
        confidences = []

        for i, word in enumerate(data['text']):
            if str(word).strip():
                extracted_text.append(str(word))
                conf = data['conf'][i]
                if conf != '-1' and isinstance(conf, (int, float)):
                    confidences.append(float(conf))

        final_text = " ".join(extracted_text).strip()
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

        needs_review = avg_confidence < OCR_CONFIDENCE_THRESHOLD

        return {
            "text": final_text,
            "confidence": avg_confidence,
            "needs_review": needs_review
        }
    except Exception as e:
        return {"text": "", "confidence": 0.0, "needs_review": True, "error": str(e)}
