import re, json
from lxml import etree

BOOK_MAP = {
    "GEN": "Genesis", "EXO": "Exodus", "LEV": "Leviticus", "NUM": "Numbers",
    "DEU": "Deuteronomy", "JOS": "Joshua", "JDG": "Judges", "RUT": "Ruth",
    "1SA": "1 Samuel", "2SA": "2 Samuel", "1KI": "1 Kings", "2KI": "2 Kings",
    "1CH": "1 Chronicles", "2CH": "2 Chronicles", "EZR": "Ezra", "NEH": "Nehemiah",
    "EST": "Esther", "JOB": "Job", "PSA": "Psalms", "PRO": "Proverbs",
    "ECC": "Ecclesiastes", "SNG": "Song of Solomon", "ISA": "Isaiah", "JER": "Jeremiah",
    "LAM": "Lamentations", "EZK": "Ezekiel", "DAN": "Daniel", "HOS": "Hosea",
    "JOL": "Joel", "AMO": "Amos", "OBA": "Obadiah", "JON": "Jonah",
    "MIC": "Micah", "NAM": "Nahum", "HAB": "Habakkuk", "ZEP": "Zephaniah",
    "HAG": "Haggai", "ZEC": "Zechariah", "MAL": "Malachi", "MAT": "Matthew",
    "MRK": "Mark", "LUK": "Luke", "JHN": "John", "ACT": "Acts",
    "ROM": "Romans", "1CO": "1 Corinthians", "2CO": "2 Corinthians", "GAL": "Galatians",
    "EPH": "Ephesians", "PHP": "Philippians", "COL": "Colossians", "1TH": "1 Thessalonians",
    "2TH": "2 Thessalonians", "1TI": "1 Timothy", "2TI": "2 Timothy", "TIT": "Titus",
    "PHM": "Philemon", "HEB": "Hebrews", "JAS": "James", "1PE": "1 Peter",
    "2PE": "2 Peter", "1JN": "1 John", "2JN": "2 John", "3JN": "3 John",
    "JUD": "Jude", "REV": "Revelation",
}

BOOK_ORDER = {code: i + 1 for i, code in enumerate(BOOK_MAP.keys())}
tree = etree.parse("spa-rv1909.usfx.xml")
root = tree.getroot()
verses = []

current_book_code = None
current_chapter = None
current_verse = None
buffer = []

def flush():
    global current_verse, buffer
    if current_book_code and current_chapter and current_verse:
        text = re.sub(r"\s+", " ", "".join(buffer)).strip()
        text = re.sub(r"\s+([,;:.!?])", r"\1", text)
        if text:
            verses.append({
                "book": BOOK_MAP[current_book_code],
                "book_order": BOOK_ORDER[current_book_code],
                "chapter": current_chapter, "verse": current_verse, "text": text,
            })
    buffer = []

for book_el in root.findall("book"):
    book_id = book_el.get("id")
    if book_id not in BOOK_MAP:
        continue
    current_book_code = book_id
    current_chapter = current_verse = None
    buffer = []
    for el in book_el.iter():
        tag = el.tag
        if tag == "c":
            flush(); current_chapter = int(el.get("id")); current_verse = None
        elif tag == "v":
            flush(); current_verse = int(el.get("id").split("-")[0].split(",")[0])
        elif tag == "ve":
            flush()
        elif tag in ("w", "add", "p", "q", "it", "bd"):
            if el.text: buffer.append(el.text)
            if el.tail: buffer.append(el.tail)
    flush()

with open("verses.json", "w", encoding="utf-8") as f:
    json.dump(verses, f, ensure_ascii=False)

# --- summary / integrity report ---
books = {}
dups = {}
seen = set()
empties = 0
for v in verses:
    books.setdefault(v["book"], 0)
    books[v["book"]] += 1
    key = (v["book"], v["chapter"], v["verse"])
    if key in seen:
        dups[key] = dups.get(key, 1) + 1
    seen.add(key)
    if not v["text"] or not v["text"].strip():
        empties += 1

print("TOTAL_VERSES:", len(verses))
print("DISTINCT_BOOKS:", len(books))
print("DUPLICATE_KEYS:", len(dups))
print("EMPTY_TEXT_ROWS:", empties)
print("MISSING_BOOKS:", [b for b in BOOK_MAP.values() if b not in books])

def show(book, ch, vs):
    for v in verses:
        if v["book"] == book and v["chapter"] == ch and v["verse"] == vs:
            print(f"  {book} {ch}:{vs} -> {v['text'][:90]}")
            return
    print(f"  {book} {ch}:{vs} -> NOT FOUND")

print("SPOT_CHECKS:")
show("Genesis", 1, 1)
show("John", 3, 16)
show("1 Peter", 5, 7)
