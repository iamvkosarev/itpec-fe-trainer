#!/usr/bin/env python3
"""Assigns a syllabus category to a question.

The ITPEC PDFs carry no category metadata, so this is a heuristic: weighted
keyword matching over the question text, backed by a positional prior (the
exams follow the syllabus order, Technology -> Management -> Strategy).
"""
import re

# (top-level field, category, keywords). Keywords are matched case-insensitively
# as whole words; a multi-word keyword must appear as a phrase.
RULES = [
    ("Technology", "Basic Theory", [
        "binary", "hexadecimal", "octal", "radix", "two's complement", "floating point",
        "ieee 754", "bit", "logical operation", "boolean", "karnaugh", "truth table",
        "exclusive or", "xor", "probability", "permutation", "combination", "factorial",
        "matrix", "vector", "set theory", "venn", "graph theory", "regression",
        "standard deviation", "variance", "correlation", "mean", "median", "normal distribution",
        "automaton", "automata", "state transition", "finite state", "bnf", "reverse polish",
        "syntax", "huffman", "entropy", "information theory", "error correction", "hamming",
        "parity", "crc", "checksum", "compression", "encoding", "ascii", "unicode",
        "numerical analysis", "newton", "interpolation", "queuing theory", "markov",
        "neural network", "deep learning", "machine learning", "artificial intelligence",
        "genetic algorithm", "fuzzy",
    ]),
    ("Technology", "Algorithms & Programming", [
        "algorithm", "sorting", "bubble sort", "quick sort", "merge sort", "insertion sort",
        "selection sort", "heap sort", "shell sort", "binary search", "linear search",
        "hash", "hashing", "collision", "linked list", "stack", "queue", "deque",
        "binary tree", "binary search tree", "b-tree", "heap", "traversal", "recursion",
        "recursive", "pseudocode", "pseudo programming", "flowchart", "time complexity",
        "computational complexity", "big o", "array", "pointer", "data structure",
        "procedure", "function call", "variable", "loop", "iteration", "list structure",
        "programming language", "compiler", "interpreter", "java", "python", "javascript",
        "html", "xml", "json", "css", "markup", "garbage collection", "recursive call",
    ]),
    ("Technology", "Computer Systems", [
        "cpu", "processor", "pipeline", "clock", "mips", "instruction", "register",
        "cache", "cache memory", "main memory", "virtual memory", "paging", "page fault",
        "lru", "fifo", "dram", "sram", "rom", "ram", "flash memory", "ssd",
        "hard disk", "raid", "storage", "bus", "interrupt", "dma", "usb", "interface",
        "throughput", "turnaround time", "response time", "benchmark", "capacity planning",
        "mtbf", "mttr", "availability", "reliability", "fault tolerance", "failover",
        "hot standby", "duplex", "clustering", "load balanc", "scale out", "scale up",
        "operating system", "kernel", "scheduler", "scheduling", "task", "thread",
        "process", "deadlock", "semaphore", "mutual exclusion", "spooling", "swapping",
        "file system", "directory", "middleware", "virtualization", "hypervisor",
        "container", "docker", "grid computing", "cloud", "iaas", "paas", "saas",
        "multiprocessor", "parallel processing", "logic circuit", "flip-flop", "gate",
        "d/a", "a/d", "sensor", "actuator", "embedded", "microcomputer", "fpga", "asic",
        "amdahl", "little's law", "batch processing", "real-time",
    ]),
    ("Technology", "Database", [
        "database", "relational", "rdbms", "sql", "select statement", "normalization",
        "normal form", "primary key", "foreign key", "candidate key", "functional dependency",
        "e-r diagram", "entity", "relational algebra", "projection", "join", "natural join",
        "outer join", "index", "transaction", "acid", "commit", "rollback", "deadlock",
        "concurrency", "exclusive lock", "shared lock", "two-phase lock", "checkpoint",
        "recovery", "backup", "data warehouse", "data mart", "olap", "data mining",
        "nosql", "key-value", "big data", "view", "stored procedure", "cursor",
        "referential integrity", "tuple", "cardinality", "schema",
    ]),
    ("Technology", "Network", [
        "network", "lan", "wan", "ethernet", "tcp/ip", "tcp", "udp", "ip address",
        "ipv4", "ipv6", "subnet", "subnet mask", "cidr", "default gateway", "router",
        "routing", "switch", "hub", "bridge", "repeater", "mac address", "arp", "dns",
        "dhcp", "nat", "napt", "proxy", "http", "https", "ftp", "smtp", "pop3", "imap",
        "snmp", "ntp", "osi", "osi model", "data link", "physical layer", "transport layer",
        "packet", "frame", "collision", "csma/cd", "csma/ca", "wireless lan", "wi-fi",
        "bluetooth", "mobile network", "5g", "lte", "bandwidth", "transmission",
        "bit rate", "baud", "multiplex", "vpn", "vlan", "qos", "cdn", "port number",
        "url", "uri", "web server", "socket", "broadcast", "multicast", "mtu",
    ]),
    ("Technology", "Security", [
        "security", "encryption", "cryptography", "cipher", "public key", "private key",
        "symmetric key", "common key", "rsa", "aes", "des", "digital signature",
        "certificate", "certificate authority", "pki", "hash function", "sha", "md5",
        "message digest", "authentication", "biometric", "two-factor", "multi-factor",
        "password", "single sign-on", "access control", "authorization", "firewall",
        "dmz", "ids", "ips", "waf", "malware", "virus", "worm", "trojan", "ransomware",
        "spyware", "phishing", "social engineering", "sql injection", "cross-site scripting",
        "xss", "csrf", "buffer overflow", "dos attack", "ddos", "brute force",
        "vulnerability", "penetration test", "risk assessment", "risk analysis",
        "isms", "iso 27001", "information security", "security policy", "incident response",
        "csirt", "soc", "digital forensic", "ssl", "tls", "ipsec", "s/mime", "wpa",
        "zero trust", "botnet", "spoofing", "keylogger", "backdoor", "honeypot",
        "penetration", "threat", "confidentiality", "integrity", "availability",
    ]),
    ("Technology", "Technology Elements", [
        "human interface", "user interface", "gui", "usability", "accessibility",
        "multimedia", "image processing", "computer graphics", "jpeg", "mpeg", "gif",
        "png", "codec", "rendering", "anti-aliasing", "virtual reality", "augmented reality",
        "barcode", "qr code", "rfid", "ocr", "speech recognition", "web design",
    ]),
    ("Technology", "Development Technology", [
        "software development", "development process", "waterfall", "agile", "scrum",
        "sprint", "xp", "extreme programming", "spiral model", "prototyping",
        "devops", "ci/cd", "continuous integration", "requirements definition",
        "requirements analysis", "external design", "internal design", "module design",
        "structured design", "object-oriented", "uml", "class diagram", "sequence diagram",
        "use case", "activity diagram", "inheritance", "polymorphism", "encapsulation",
        "design pattern", "coupling", "cohesion", "refactoring", "code review",
        "unit test", "integration test", "system test", "regression test", "black box",
        "white box", "test case", "test coverage", "boundary value", "equivalence partition",
        "cyclomatic", "debugging", "reverse engineering", "reengineering", "maintenance",
        "version control", "configuration management", "software reuse", "mashup",
        "cmmi", "function point", "cocomo", "lines of code", "software metrics",
        "user story", "kanban", "pair programming", "test-driven",
    ]),
    ("Management", "Project Management", [
        "project management", "pmbok", "project manager", "project plan", "project scope",
        "wbs", "work breakdown", "gantt", "arrow diagram", "pert", "critical path",
        "cpm", "earned value", "evm", "pv", "ev", "ac", "spi", "cpi", "schedule variance",
        "cost variance", "milestone", "float", "slack time", "resource level",
        "project risk", "stakeholder", "project charter", "project cost", "crashing",
        "fast tracking", "project schedule", "project quality", "man-month", "manhour",
    ]),
    ("Management", "Service Management", [
        "service management", "itil", "service level agreement", "sla", "service desk",
        "help desk", "incident management", "problem management", "change management",
        "release management", "configuration item", "cmdb", "capacity management",
        "availability management", "continuity management", "service catalog",
        "system operation", "operation management", "backup operation", "system audit",
        "internal control", "audit trail", "auditor", "facility management",
        "ups", "data center", "green it", "escalation", "rto", "rpo", "disaster recovery",
        "business continuity", "bcp", "chargeback",
    ]),
    ("Strategy", "System Strategy", [
        "system strategy", "information strategy", "system planning", "enterprise architecture",
        "business process", "bpr", "bpm", "bpo", "business model", "soa",
        "solution business", "outsourcing", "asp", "system life cycle", "investment",
        "roi", "total cost of ownership", "tco", "cost-benefit", "rfi", "rfp",
        "request for proposal", "procurement", "vendor selection", "requirement definition",
        "it governance", "digital transformation", "dx", "e-government", "smart city",
    ]),
    ("Strategy", "Business Strategy", [
        "business strategy", "marketing", "swot", "pest", "3c analysis", "4p",
        "value chain", "core competence", "competitive advantage", "market share",
        "product portfolio", "ppm", "niche", "benchmarking", "m&a", "alliance",
        "balanced scorecard", "kpi", "kgi", "crm", "sfa", "erp", "scm", "sis",
        "e-commerce", "ec", "b2b", "b2c", "o2o", "long tail", "affiliate",
        "iot", "fintech", "blockchain", "cryptocurrency", "sharing economy",
        "engineering system", "cad", "cam", "cim", "fa", "mrp", "jit", "kanban system",
        "technology roadmap", "mot", "innovation", "patent strategy", "delphi",
        "product life cycle", "penetration pricing", "skimming",
    ]),
    ("Strategy", "Corporate & Legal Affairs", [
        "corporate", "management organization", "cio", "ceo", "board of directors",
        "matrix organization", "project organization", "accounting", "balance sheet",
        "income statement", "cash flow", "profit", "gross profit", "operating income",
        "break-even", "break even", "fixed cost", "variable cost", "depreciation",
        "inventory", "fifo method", "moving average", "roe", "roa",
        "linear programming", "operations research", "ie", "qc", "quality control",
        "pareto", "cause and effect", "fishbone", "histogram", "scatter diagram",
        "control chart", "check sheet", "abc analysis", "game theory", "decision tree",
        "expected value", "intellectual property", "copyright", "patent", "trademark",
        "trade secret", "unfair competition", "license agreement", "software license",
        "open source", "gpl", "labor law", "worker dispatch", "outsourcing contract",
        "subcontract", "personal information", "privacy", "gdpr", "compliance",
        "corporate governance", "whistleblow", "standardization", "iso", "jis",
        "ieee", "w3c", "iso 9000", "iso 14000", "cybersecurity management",
    ]),
]

# Compiled once: (field, category, [regex]).
_COMPILED = [
    (field, cat, [re.compile(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])") for k in kws])
    for field, cat, kws in RULES
]

# Fraction of the paper devoted to each field, used as a positional fallback.
# Both the 80-question and the 60-question papers follow Technology, then
# Management, then Strategy.
_FIELD_ORDER = [("Technology", 0.625), ("Management", 0.125), ("Strategy", 0.25)]


def _positional_field(no, total):
    if not total:
        return "Technology"
    pos = float(no) / total
    acc = 0.0
    for field, share in _FIELD_ORDER:
        acc += share
        if pos <= acc:
            return field
    return "Strategy"


def classify(text, no=0, total=0, part="A"):
    """Returns (field, category). `no`/`total` enable the positional prior."""
    if part == "B":
        low = text.lower()
        sec = sum(1 for rx in _COMPILED[5][2] if rx.search(low))
        # Subject B is half algorithms, half information security.
        if sec >= 3:
            return ("Technology", "Security")
        return ("Technology", "Algorithms & Programming")

    low = text.lower()
    prior = _positional_field(no, total)
    best, best_score = None, 0.0
    for field, cat, regexes in _COMPILED:
        hits = sum(1 for rx in regexes if rx.search(low))
        if not hits:
            continue
        score = hits + (0.75 if field == prior else 0.0)
        if score > best_score:
            best, best_score = (field, cat), score
    if best is None or best_score < 1.5:
        # No confident keyword signal: fall back to where the question sits.
        fallback = {
            "Technology": ("Technology", "Computer Systems"),
            "Management": ("Management", "Project Management"),
            "Strategy": ("Strategy", "Corporate & Legal Affairs"),
        }
        return best if best else fallback[prior]
    return best
