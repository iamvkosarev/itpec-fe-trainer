#!/usr/bin/env python3
"""Ties Subject A questions to the blocks of the cheat sheet.

The cheat sheet (web/docs/cheatsheet.html) is split into sections (<section
id>) and blocks (<article id>). For each block this writes the questions of
the bank that ask about the same thing, so the sheet can build a test from the
picked blocks and grade each block by how its questions were answered.

A question belongs to a block when
  * the block cites it (a «2025S·Q8» mark), or
  * the block's keywords score high enough in its text — every version of the
    question, its text layer from the PDF, the words Apple Vision reads off the
    picture (figure labels the text layer lacks) and the English terms of its
    explanation, or
  * it falls just short on keywords, but Apple's English sentence embedding
    puts it closest to this block of all the blocks its category allows.

One entry per question (the newest version, like practice), so a test never
asks the same thing twice. Only reads the bank: IDs and progress are untouched.

    swiftc -O tools/apple_nlp.swift -o tools/.bin/apple_nlp   # once
    python3 tools/topics.py [--report analysis/topics.md]
"""
import argparse
import datetime
import glob
import html
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
SHEET = ROOT / "web" / "docs" / "cheatsheet.html"
OCR = ROOT / "raw" / "ocr-a.json"
NLP = ROOT / "tools" / ".bin" / "apple_nlp"
OUT = DATA / "topics.json"

# A block takes a question at this keyword score when the question's category
# is one the section allows, and at OUT_OF_GATE outside it (the categories are
# themselves guessed from keywords, so a strong match may still be right).
THRESHOLD = 3
OUT_OF_GATE = 6
# Sentence-embedding rescue: a question with some keyword evidence but under
# the threshold joins the block it is semantically nearest to, if close enough.
SEMANTIC_MIN_SCORE = 2
# A firewall question also mentions packets and ports; it belongs to the
# firewall block, not to OSI. Blocks under this share of the best score drop out.
RELATIVE = 0.7
SEMANTIC_MIN_SIM = 0.74

TECH = ["Computer Systems", "Basic Theory", "Technology Elements", "Algorithms & Programming"]
GATES = {
    "cpu": TECH,
    "os": ["Computer Systems", "Technology Elements", "Algorithms & Programming"],
    "notation": ["Algorithms & Programming", "Basic Theory", "Technology Elements"],
    "net": ["Network", "Security", "Technology Elements"],
    "sec": ["Security", "Network", "Corporate & Legal Affairs"],
    "strategy": ["Corporate & Legal Affairs", "Business Strategy", "System Strategy",
                 "Project Management", "Service Management", "Development Technology"],
}

# Block id -> [(weight, regex)], matched once each against the lowercased text.
# 3 is enough on its own; 1–2 only together. A negative weight vetoes look-alikes
# (a buffer overflow is not the cpu buffer).
P = {
    "cpu-mips": [(3, r"\bmips\b"), (3, r"\bcpi\b"), (3, r"instructions? per second"),
                 (3, r"cycles? per instruction"), (2, r"clock (frequency|cycle)"), (1, r"\b[gm]hz\b"),
                 (-6, r"earned value|\bspi\b|consumer price")],
    "cpu-mix": [(3, r"instruction mix"), (2, r"appearance (ratio|rate|frequency)"),
                (1, r"execution time"), (1, r"\bmips\b")],
    "cpu-perf": [(3, r"\b(16|32|64)-bit (cpu|processor)"), (3, r"amdahl"), (2, r"speed[- ]?up"),
                 (2, r"(reduc|improv|shorten)\w* .{0,40}(processing|execution) time"),
                 (1, r"performance"), (1, r"\bcpu\b")],
    "cpu-cache": [(3, r"\bcache"), (3, r"hit (ratio|rate)"), (3, r"(effective|average) (memory )?access time"),
                  (3, r"write[- ](back|through)"), (2, r"interleav"), (1, r"main memory"),
                  (-6, r"cache poisoning|buffer overflow")],
    "cpu-datasize": [(2, r"\bpixels?\b"), (3, r"\d+-bit colou?r|colou?rs? (per|of) (\d+ )?bits?"),
                     (2, r"\bdpi\b"), (2, r"(image|picture|screen|video|audio|sound) data"),
                     (2, r"how many (bytes|kilobytes|megabytes|gigabytes|[kmg]bytes)"),
                     (1, r"sampl(ing|ed)"), (1, r"resolution"), (1, r"\bbytes?\b")],
    "cpu-buffer": [(3, r"\bbuffer"), (-6, r"buffer overflow")],
    "cpu-pipeline": [(3, r"pipelin"), (3, r"superscalar|\bvliw\b"),
                     (2, r"\bfetch\w*.{0,60}\bdecod|\bdecod\w*.{0,60}\bexecut")],
    "cpu-availability": [(3, r"\bmtbf\b"), (3, r"\bmttr\b"), (2, r"availability|operating rate|operation rate"),
                         (2, r"(connected )?in (series|parallel)"), (2, r"failure rate"),
                         (2, r"(hot|cold|warm) standby|duplex system|dual system|duplicated"),
                         (1, r"reliab")],
    "cpu-raid": [(3, r"\braid\b"), (3, r"striping"), (3, r"mirroring"), (3, r"disk array"),
                 (2, r"parity (disk|data|information|block)")],
    "cpu-hex": [(3, r"hexadecimal"), (3, r"\boctal\b"), (2, r"binary (number|representation|notation|fraction|value)"),
                (2, r"decimal (number|representation|notation|fraction|value)"), (2, r"radix|base[- ](2|8|16)\b"),
                (2, r"two'?s complement|\bcomplement\b"), (1, r"\bshift")],
    "cpu-ieee754": [(3, r"ieee\s?754"), (3, r"floating[- ]point"), (3, r"single precision|double precision"),
                    (2, r"mantissa|exponent part|fraction part|\bexponent\b"), (2, r"fixed[- ]point")],
    "cpu-hw-terms": [(3, r"fail[- ]?safe"), (3, r"fail[- ]?soft"), (3, r"fool[- ]?proof"),
                     (3, r"fault[- ]toleran"), (3, r"actuator"), (2, r"\bsensors?\b"),
                     (3, r"\blinker\b|\bloader\b|linkage editor"), (3, r"\busb\b"), (3, r"defragment"),
                     (3, r"mission[- ]critical"), (2, r"fail[- ]?over|fault avoidance"),
                     (1, r"\bcompiler\b|\binterpreter\b")],

    "os-states": [(3, r"(ready|running|wait(ing)?|blocked|executable|execution) (state|status)"),
                  (3, r"(state|status) transition.{0,80}(task|process)|(task|process).{0,80}(state|status) transition"),
                  (2, r"dispatch"), (2, r"multi[- ]?(task|programm)"), (1, r"\btasks?\b")],
    "os-times": [(3, r"turnaround time"), (2, r"waiting time"), (2, r"arrival time"),
                 (1, r"response time"), (1, r"\bcpu time\b|processing time"), (1, r"throughput")],
    "os-scheduling": [(3, r"round[- ]robin"), (3, r"\bfcfs\b|first[- ]come[,]? first[- ]serv"),
                      (3, r"\bspt\b|\bsjf\b|shortest (processing|job)"), (3, r"time (quantum|slice)"),
                      (2, r"schedul"), (2, r"preempt"), (2, r"priority (scheduling|order|based)"), (1, r"dispatch")],
    "os-fcfs-spt": [(3, r"\bspt\b|\bsjf\b|shortest (processing|job)"), (2, r"\bfcfs\b|first[- ]come"),
                    (2, r"gantt"), (1, r"schedul")],
    "os-fcfs-wait": [(3, r"\bfcfs\b|first[- ]come[,]? first[- ]serv"), (2, r"(average )?waiting time"),
                     (1, r"arrival")],
    "os-preemptive": [(3, r"preempt"), (2, r"(higher|highest|lower|lowest) priority"), (1, r"priority")],
    "os-interrupts": [(3, r"interrupt"), (3, r"\bsvc\b|supervisor call")],
    "os-paging": [(3, r"page (fault|replacement|frame|table|reference|in|out)"), (3, r"\bpaging\b"),
                  (3, r"virtual (memory|storage|address)"), (3, r"thrashing"), (2, r"\blru\b|\blfu\b"),
                  (1, r"\bfifo\b"), (2, r"swap(ping)?\b|roll[- ]?in|roll[- ]?out"), (2, r"\bmmu\b|memory management unit"),
                  (2, r"address translation|logical address|physical address"),
                  (1, r"fragmentation|compaction|garbage collection")],

    "notation-notation": [(3, r"reverse polish|polish notation"), (3, r"\b(postfix|prefix|infix)\b"),
                          (2, r"(expression|formula).{0,60}notation|notation.{0,60}(expression|formula)")],
    "notation-stack": [(3, r"\bstacks?\b"), (3, r"\bpush\w*\b|\bpop\b"), (2, r"\bqueues?\b"),
                       (2, r"\blifo\b|\bfifo\b"), (3, r"enqueue|dequeue|\bdeque\b"),
                       (-6, r"queu(e|ing) (theory|model|system)|m/m/1|protocol stack")],
    "notation-tree": [(3, r"binary (search )?tree"), (3, r"\b(preorder|inorder|postorder|pre-order|in-order|post-order)\b"), (2, r"travers"),
                      (2, r"subtree"), (2, r"b[- ]tree|avl|balanced tree|complete binary"),
                      (1, r"\bheap\b"), (1, r"\bnodes?\b"), (1, r"\bleaf|leaves\b"), (1, r"\btree\b")],
    "notation-graph": [(3, r"depth[- ]first|breadth[- ]first|\bdfs\b|\bbfs\b"), (3, r"adjacency (matrix|list)"),
                       (3, r"(un)?directed graph"), (2, r"\bvert(ex|ices)\b"), (2, r"shortest (path|route)|dijkstra"),
                       (1, r"\bgraph\b"), (1, r"\bedges?\b")],
    "notation-sorting": [(3, r"(bubble|quick|merge|insertion|selection|heap|shell|bucket|radix)[- ]?sort"),
                         (3, r"computational complexity|time complexity|\bo\(n|order of n"), (3, r"\bpivot"),
                         (2, r"\bsort(ing|ed|s)?\b"), (2, r"binary search|linear search|sequential search"),
                         (1, r"\bcompar(e|es|ed|ing|isons?)\b")],

    "net-osi": [(-9, r"open source (initiative|definition)|\bedi\b|electronic data interchange"), (3, r"\bosi\b"), (3, r"(physical|data[- ]link|network|transport|session|presentation|application) layer"),
                (3, r"\brepeaters?\b"), (2, r"\bbridges?\b"), (2, r"\brouters?\b"), (2, r"\bgateways?\b"),
                (2, r"\bhubs?\b"), (3, r"switching hub|\bl[23] switch|layer[- ]?[23] switch"),
                (2, r"\btcp\b|\budp\b"), (3, r"\bicmp\b"), (2, r"flow control"), (1, r"tcp/ip"),
                (1, r"protocol"), (1, r"\bframes?\b"), (1, r"\bpackets?\b")],
    "net-ip-mac": [(3, r"\b(r)?arp\b"), (3, r"mac address"), (3, r"\bdns\b|domain name"), (3, r"\bdhcp\b"),
                   (3, r"\bnat\b|\bnapt\b|ip masquerade|address translation"), (2, r"ipv6"),
                   (2, r"(private|global) (ip )?address"), (1, r"ip address"), (1, r"broadcast")],
    "net-subnet": [(3, r"subnet"), (3, r"\bcidr\b"), (3, r"netmask|network mask|address mask"),
                   (3, r"broadcast address"), (2, r"network address"), (3, r"host address|number of hosts|host part"),
                   (3, r"class [abcd] (ip )?(address|network)"), (1, r"\d+\.\d+\.\d+\.\d+"), (1, r"/\d\d\b")],
    "net-wireless": [(3, r"\blte\b|\b[345]g\b"), (2, r"wireless"), (3, r"802\.11|wi[- ]?fi|\bwlan\b"),
                     (3, r"bluetooth|\bnfc\b|\buwb\b|zigbee|\blpwa\b"), (3, r"tethering"),
                     (2, r"mobile (phone|communication|network|terminal)|cellular|smartphone"),
                     (3, r"\bmimo\b|csma/ca"), (2, r"\bssid\b|\bessid\b|\bwpa\d?\b|\bwep\b")],
    "net-utilities": [(3, r"\bping\b"), (3, r"traceroute|tracert"), (3, r"netstat"), (3, r"ipconfig|ifconfig"),
                      (3, r"nslookup"), (3, r"arp -a"), (2, r"\bsnmp\b"), (2, r"\bntp\b"), (1, r"\btelnet\b|\bssh\b")],
    "net-email": [(3, r"\bsmtp\b"), (3, r"\bpop3?\b|\bimap4?\b"), (2, r"e-?mails?\b|electronic mail"),
                  (3, r"\bspf\b|\bdkim\b|dmarc"), (3, r"s/mime"), (2, r"\bmime\b"), (2, r"port numbers?"),
                  (3, r"well[- ]known port"),
                  (2, r"transmission (time|efficiency|speed|rate)|transfer time|line speed|\d\s?[kmg]?bps\b|bits per second"),
                  (1, r"utilization")],

    "sec-pki": [(3, r"public[- ]key"), (2, r"private key|secret key"), (3, r"digital signature"),
                (2, r"certificate"), (3, r"\bpki\b|certificat(e|ion) authority|\bca\b"), (2, r"\bhash|message digest"),
                (2, r"\bssl\b|\btls\b"), (1, r"decrypt|encrypt")],
    "sec-ciphers": [(3, r"common key|symmetric|shared key"), (3, r"\brsa\b|\baes\b|\bdes\b|elgamal|elliptic|diffie|\bdsa\b"),
                    (3, r"hybrid (encryption|cryptosystem|scheme|method)"), (3, r"stream cipher|block cipher"),
                    (1, r"cipher|cryptograph|encrypt")],
    "sec-cia": [(2, r"confidentiality"), (2, r"\bintegrity\b"), (2, r"authenticity|accountability|non[- ]?repudiation"),
                (3, r"iso/iec 27\d{3}|\bisms\b|information security management"),
                (3, r"(element|propert|characteristic)\w* of information security"), (1, r"availability"),
                (-6, r"referential integrity")],
    "sec-passwords": [(3, r"brute[- ]force"), (3, r"dictionary attack"),
                      (3, r"(password|credential) (list|stuffing|crack|attack)|password list attack"),
                      (3, r"reverse brute"), (3, r"rainbow table"), (3, r"\bsalt(ed)?\b"), (2, r"passwords?"),
                      (2, r"one[- ]time password|\botp\b"), (2, r"multi[- ]factor|two[- ]factor|biometric"),
                      (2, r"challenge[- ]response")],
    "sec-social": [(3, r"social engineering"), (3, r"phishing"), (3, r"shoulder (hacking|surfing)"),
                   (3, r"tailgating|piggyback"), (3, r"trashing|dumpster"), (3, r"baiting|pretext"),
                   (1, r"impersonat")],
    "sec-web": [(3, r"sql injection"), (3, r"cross[- ]site"), (3, r"\bxss\b|\bcsrf\b"), (3, r"placeholder"),
                (3, r"malware|virus|\bworms?\b|trojan|ransomware|spyware|rootkit|botnet|\bbots?\b|back ?door|keylogger"),
                (3, r"buffer overflow"),
                (3, r"directory traversal|command injection|session hijack|clickjacking|drive[- ]by|zero[- ]day|watering hole"),
                (3, r"\bd?dos\b|denial[- ]of[- ]service"), (2, r"sanitiz|escape processing"),
                (2, r"spoofing|man[- ]in[- ]the[- ]middle")],
    "sec-defense": [(3, r"firewall"), (3, r"\bwaf\b"), (3, r"\bids\b|\bips\b|intrusion (detection|prevention)"),
                    (3, r"\bdmz\b"), (3, r"honeypot"), (3, r"sandbox"), (3, r"\bvpn\b"), (3, r"\bvlan\b"),
                    (3, r"packet filter"), (2, r"\bproxy"), (3, r"\bsiem\b|\butm\b"),
                    (2, r"penetration test|vulnerability (scan|assessment|diagnos)|fuzzing"),
                    (2, r"access control list|\bacl\b"), (2, r"ipsec")],
    "sec-orgs": [(3, r"\bcsirt\b|\bsoc\b|\bcert\b|cert/cc|jpcert"), (3, r"port scan"),
                 (3, r"risk (treatment|avoidance|reduction|transfer|acceptance|retention|sharing|assessment|analysis|response)"),
                 (3, r"\bfar\b|\bfrr\b|false (acceptance|rejection)"), (2, r"security (policy|incident)"),
                 (2, r"\bisms\b"), (3, r"forensic")],

    "strategy-break-even": [(3, r"break[- ]?even"), (3, r"fixed costs?"), (3, r"variable costs?"),
                            (3, r"contribution margin|marginal profit"), (2, r"(target|desired) profit"),
                            (1, r"sales (amount|volume|quantity|revenue)"), (1, r"operating (profit|income)")],
    "strategy-product-mix": [(3, r"product mix"), (3, r"linear programming"), (2, r"(maximi[sz]e|maximum) (the )?profit"),
                             (2, r"(machine|production|processing) (time|hours) (per|available|of)"), (1, r"per unit")],
    "strategy-evm": [(3, r"earned value|\bevm\b"), (3, r"planned value|actual cost"), (3, r"\bspi\b"),
                     (3, r"schedule variance|cost variance"), (1, r"\bpv\b|\bev\b|\bac\b")],
    "strategy-estimates": [(3, r"three[- ]point|\bpert\b"), (3, r"critical path"), (2, r"arrow diagram|\bdummy\b"),
                           (3, r"total float|\bfloat\b|slack time"), (3, r"(earliest|latest) (start|finish|node)"),
                           (3, r"communication (channels|paths|lines)"), (3, r"function point"), (3, r"cocomo"),
                           (2, r"(man|person|staff)[- ]?(months?|days?|hours?)"), (2, r"gantt"),
                           (3, r"crashing|fast[- ]tracking|precedence diagram"),
                           (2, r"(project|work) duration|shorten the (project|schedule)"), (1, r"activit")],
    "strategy-oc-curve": [(3, r"\boc curve|operating characteristic"), (3, r"acceptance (sampling|number|inspection)"),
                          (3, r"sampling inspection"), (2, r"defective (rate|ratio|items|products)"),
                          (3, r"producer.s risk|consumer.s risk")],
    "strategy-formulas": [(3, r"\broi\b|return on investment"), (3, r"payback"), (3, r"\btco\b|total cost of ownership"),
                          (3, r"cost of (goods|sales)"), (3, r"expected value"), (3, r"depreciation"),
                          (2, r"inventory (turnover|valuation)|first[- ]in[,]? first[- ]out method|moving average method|weighted average"),
                          (2, r"net present value|\bnpv\b|discount rate"), (3, r"economic order quantity|reorder point"),
                          (2, r"decision tree|maximin|maximax|minimax|regret"), (1, r"rate of return|profit rate")],
    "strategy-legal": [(3, r"copyright"), (3, r"\bpatents?\b"), (2, r"licen[cs]"), (3, r"\bgpl\b|open source"),
                       (3, r"trademark|trade secret|unfair competition"), (2, r"personal information|privacy"),
                       (3, r"(worker )?dispatch(ed)? (work|worker|contract)|subcontract|quasi[- ]mandate|contract for work"),
                       (3, r"balance sheet"), (3, r"income statement|profit and loss"), (2, r"(gross|operating|ordinary|net) profit"),
                       (3, r"cash flow"), (3, r"financial statement"), (3, r"\bwto\b|government procurement"),
                       (1, r"\blaws?\b|legal|penal|\bact (on|of|against)\b"), (2, r"labou?r (standard|law)|whistle"), (1, r"compliance"),
                       (2, r"current ratio|equity ratio|liabilit"), (1, r"\bassets\b"), (1, r"standardi[sz]|de facto|\bjis\b")],
    "strategy-org": [(3, r"\btqm\b|total quality management"), (3, r"corporate governance"), (3, r"accountability"),
                     (3, r"diversity"), (2, r"cell production|line production"),
                     (3, r"(tacit|explicit) knowledge|knowledge management"),
                     (2, r"\bcsr\b|corporate social|\bsdgs\b|stakeholder"), (1, r"compliance")],
    "strategy-org-structure": [(3, r"(matrix|project|functional|divisional|hierarchical|flat|network|line[- ]and[- ]staff) organi[sz]ation"),
                               (3, r"in-house (company|venture)|company system organi"), (3, r"task force"),
                               (2, r"span of control|organi[sz]ational (structure|form)")],
    "strategy-cxo": [(3, r"\bc[eiftoc]o\b|\bciso\b|chief [a-z]+ (executive|officer)")],
    "strategy-training": [(3, r"\bojt\b|off-jt|on[- ]the[- ]job training"), (3, r"in-basket|ro(le|ll)[- ]?playing|case study|\bdebate\b"),
                          (3, r"e-learning|coaching|mentoring"),
                          (3, r"management by objectives?|\bcdp\b|career development|competency"),
                          (3, r"work[- ]?sharing|discretionary labou?r|hygiene (theory|factor)|xy theory|work-life balance"),
                          (2, r"\bmbo\b"), (1, r"training|education")],
    "strategy-qc-tools": [(3, r"pareto|abc analysis"), (3, r"histogram"), (3, r"scatter (diagram|plot|chart)"),
                          (3, r"control chart|\bucl\b|\blcl\b"), (3, r"stratification"), (3, r"check ?sheet"),
                          (3, r"cause[- ]and[- ]effect|fishbone|ishikawa"),
                          (3, r"affinity diagram|association diagram|relations? diagram|matrix diagram|matrix data analysis|tree diagram|\bpdpc\b|kj method"),
                          (3, r"z[- ]chart|z graph|radar chart|sd chart|pie intersection"), (2, r"qc tools|quality control tools")],
    "strategy-analysis": [(3, r"core competen"), (3, r"value chain"),
                          (3, r"ansoff|growth matrix|market penetration|market development|diversification"),
                          (3, r"\b[34][pc]s?\b|marketing mix|four (ps|cs)"),
                          (3, r"cost leadership|differentiation strategy|focus strategy|blue ocean"),
                          (2, r"\bm&a\b|merger|acquisition|alliance"), (2, r"benchmarking"),
                          (2, r"segmentation|positioning|targeting|\bstp\b"), (3, r"\bk[sf][fs]\b|key (success|factor)")],
    "strategy-frameworks": [(3, r"\bswot\b"), (3, r"\bpest\b"), (3, r"\bppm\b|product portfolio"),
                            (2, r"cash cow|problem child|question mark|\bstars?\b|\bdogs?\b"),
                            (3, r"balanced score ?card|\bbsc\b|strategy map"), (2, r"learning and growth|internal business process"),
                            (2, r"five forces|5 forces")],
    "strategy-positions": [(3, r"market (leader|challenger|follower|nicher)|\bnicher?\b|niche strategy"),
                           (3, r"competitive position|kotler"), (2, r"\b(leader|challenger|follower)s?\b"),
                           (3, r"omni-?directional|imitation strategy|specialization strategy")],
    "strategy-adopters": [(3, r"early adopters?|early majority|late majority|laggards?|\binnovators?\b"),
                          (3, r"innovat(ion|or) theory|diffusion of innovation|chasm"), (3, r"\baidma\b|\baisas\b|\bamtul\b")],
    "strategy-plc": [(3, r"product life ?cycle|life cycle of (a |the )?product"),
                     (3, r"(introduction|introductory|growth|maturity|mature|decline|declining) (stage|phase|period)")],
    "strategy-marketing": [(3, r"pricing"), (3, r"(penetration|skimming|prestige|going[- ]rate|cost[- ]plus|psychological) pric"),
                           (3, r"telemarketing|one[- ]to[- ]one marketing|viral marketing|permission marketing|affiliate"),
                           (3, r"\bcgm\b|long tail|\bo2o\b|omni[- ]?channel|franchis|sharing economy|crowdfunding|reverse auction"),
                           (3, r"e-commerce|electronic commerce|\bb2[bc]\b|\bc2c\b|\bseo\b"),
                           (2, r"marketing"), (1, r"advertis"), (1, r"\bprices?\b"), (2, r"fintech|cashless|mobile payment")],
    "strategy-biz-systems": [(3, r"\bscm\b|supply chain"), (3, r"\bcrm\b|customer relationship"),
                             (3, r"\bmrp\b|material requirements"), (3, r"concurrent engineering"),
                             (3, r"\berp\b|enterprise resource"), (3, r"\bsfa\b|sales force automation"),
                             (2, r"\bjit\b|just[- ]in[- ]time|kanban"), (2, r"business intelligence|data mining|data warehouse"),
                             (3, r"\brpa\b|robotic process"),
                             (2, r"\btms\b|\bwms\b|\bpos\b|\bedi\b|\bcad\b|\bcam\b|\bcim\b|\bfms\b|\brfid\b|traceability|\bplm\b"),
                             (2, r"\bdx\b|digital transformation"), (1, r"\biot\b|artificial intelligence|\bai\b"),
                             (3, r"\bcrp\b|capacity requirements"),
                             (3, r"order point|ordering method|periodic ordering|fixed[- ]quantity ordering"),
                             (2, r"\bcim\b|\bcae\b|factory automation")],
    "strategy-sys-strategy": [(3, r"enterprise architecture"), (3, r"(business|data|application|technology) architecture"),
                              (3, r"\brf[ipq]\b|request for (information|proposal|quotation)"), (1, r"portfolio"),
                              (2, r"feasibility"), (3, r"outsourc"),
                              (3, r"\bbpo\b|\bsaas\b|\bpaas\b|\biaas\b|\bsoa\b|cloud (computing|service)|hosting service|housing service"),
                              (3, r"\bbpm\b|\bbpr\b|business process (re-?engineering|management)"),
                              (3, r"green it|digital divide|green procurement"), (3, r"smart (meter|grid|city)"),
                              (2, r"requirements definition|it strategy|information (system )?strategy|computeri[sz]ation plan"),
                              (2, r"it governance|\bcobit\b|system integrat")],
    "strategy-service": [(3, r"\bitil\b"), (3, r"service level|\bsla\b|\bslm\b"),
                         (3, r"(incident|problem|change|release|configuration|capacity|availability) management|service desk|help desk"),
                         (3, r"\bbcp\b|business continuity|disaster recovery|\brto\b|\brpo\b"), (3, r"system audit"),
                         (2, r"\baudit"), (3, r"\bwbs\b|work breakdown"), (3, r"scope creep|scope (management|statement)"),
                         (3, r"(big[- ]bang|phased|parallel|pilot) (migration|conversion|transition|cutover)"),
                         (2, r"\bpmbok\b|project (charter|manager|stakeholder|scope|integration)"),
                         (3, r"facility management|\bups\b|uninterruptible"), (3, r"internal control"),
                         (2, r"service (management|operation|strategy|design|transition)")],
}
PATTERNS = {bid: [(w, re.compile(rx)) for w, rx in pats] for bid, pats in P.items()}


def load_bank():
    """Subject A questions grouped by cluster: rep id -> [versions]."""
    questions = []
    for path in sorted(glob.glob(str(DATA / "20*-A.json"))):
        questions += json.loads(Path(path).read_text("utf-8"))["questions"]
    clusters = {}
    for q in questions:
        clusters.setdefault(q.get("cluster") or q["id"], []).append(q)
    return {q["id"]: q for q in questions}, clusters


def load_terms():
    """English glossary terms of each explained question."""
    terms = {}
    for path in glob.glob(str(DATA / "explain" / "20*-A.json")):
        for qid, ex in json.loads(Path(path).read_text("utf-8")).items():
            terms[qid] = " ".join(f"{t.get('term', '')} {t.get('full', '')}" for t in ex.get("terms", []))
    return terms


def parse_sheet():
    """[(section id, title, [(block id, title, cited rep-or-version ids, text for the embedding)])]."""
    src = SHEET.read_text("utf-8")
    plain = lambda s: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()
    sections = []
    for part in re.split(r'<section id="', src)[1:]:
        sid = part[:part.index('"')]
        title = plain(re.search(r"<h2>(.*?)<small>", part, re.S).group(1))
        blocks = []
        for m in re.finditer(r'<article class="blk[^"]*" id="([^"]+)">(.*?)</article>', part, re.S):
            body = m.group(2)
            cited = []
            for mark in re.findall(r'<span class="src[^"]*">(.*?)</span>', body):
                if (q := re.search(r"(\d{4}[AS])·Q(\d+)", mark)):
                    cited.append(f"{q.group(1)}-A-{int(q.group(2)):02d}")
            # What the block is about, in the exam's own English: its terms and
            # the paraphrased exam wording, for the sentence embedding.
            english = re.findall(r'<(?:dt|i lang="en"|p class="q" lang="en")>(.*?)</|<span class="(?:term|en)">(.*?)</span>', body, re.S)
            words = " ".join(plain(a or b) for a, b in english)
            blocks.append((m.group(1), plain(re.search(r"<h3>(.*?)</h3>", body).group(1)), cited, words))
        sections.append((sid, title, blocks))
    return sections


def score(text, bid):
    """Sum of the block's matched weights; 0 on a veto or when only weak hints matched."""
    total = strongest = 0
    for weight, rx in PATTERNS[bid]:
        if rx.search(text):
            if weight < 0:
                return 0
            total += weight
            strongest = max(strongest, weight)
    return total if strongest >= 2 else 0


def keep(scores, bid, gated):
    """A block keeps a question it matches well, unless another block matches it far better."""
    s = scores[bid]
    return s >= (THRESHOLD if gated else OUT_OF_GATE) and s >= RELATIVE * max(scores.values())


def embed(texts):
    """{key: unit vector} from Apple's sentence embedding, or {} if unavailable."""
    if not NLP.exists():
        print(f"no {NLP.relative_to(ROOT)} — build it with swiftc (see header); skipping embeddings", file=sys.stderr)
        return {}
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp, "in.json"), Path(tmp, "out.json")
        src.write_text(json.dumps(texts), "utf-8")
        subprocess.run([str(NLP), "embed", str(src), str(dst)], check=True)
        vectors = json.loads(dst.read_text("utf-8"))
    unit = {}
    for key, v in vectors.items():
        norm = math.sqrt(sum(x * x for x in v)) or 1
        unit[key] = [x / norm for x in v]
    return unit


def most_repeated(rep, clusters):
    """Sort key: asked on more papers first, then the newer question."""
    year, session = int(rep[:4]), rep[4]
    return (-len(clusters[rep]), -(year * 10 + (session == "A")))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", help="write a Markdown table of every block's questions")
    args = ap.parse_args()

    by_id, clusters = load_bank()
    rep_of = {q["id"]: rep for rep, members in clusters.items() for q in members}
    terms = load_terms()
    ocr = json.loads(OCR.read_text("utf-8")) if OCR.exists() else {}
    if not ocr:
        print(f"no {OCR.relative_to(ROOT)}: matching on the PDF text only", file=sys.stderr)
    sections = parse_sheet()
    assert {b[0] for s in sections for b in s[2]} == set(P), "blocks and patterns disagree"
    section_of = {b[0]: s[0] for s in sections for b in s[2]}

    texts = {rep: " \n ".join(f"{q['text']} {ocr.get(q['id'], '')} {terms.get(q['id'], '')}" for q in members).lower()
             for rep, members in clusters.items()}
    category = {rep: members[0]["category"] for rep, members in clusters.items()}

    vectors = embed({**{f"q:{rep}": by_id[rep]["text"][:900] for rep in clusters},
                     **{f"b:{bid}": f"{title}. {words}"[:900] for _, _, blocks in sections for bid, title, _, words in blocks}})

    members = {bid: {} for bid in P}  # bid -> {rep: how}
    for _, _, blocks in sections:
        for bid, _, cited, _ in blocks:
            for qid in cited:
                if qid in rep_of:
                    members[bid][rep_of[qid]] = "cited"

    semantic = 0
    for rep, text in texts.items():
        scores = {bid: score(text, bid) for bid in P}
        for bid in scores:
            if keep(scores, bid, category[rep] in GATES[section_of[bid]]):
                members[bid].setdefault(rep, "keywords")
        if vectors and f"q:{rep}" in vectors and not any(rep in m for m in members.values()):
            qv = vectors[f"q:{rep}"]
            near = sorted(((sum(a * b for a, b in zip(qv, vectors[f"b:{bid}"])), bid) for bid in P
                           if category[rep] in GATES[section_of[bid]] and f"b:{bid}" in vectors), reverse=True)
            if near and near[0][0] >= SEMANTIC_MIN_SIM and scores[near[0][1]] >= SEMANTIC_MIN_SCORE:
                members[near[0][1]][rep] = "semantic"
                semantic += 1

    out = {
        "generated": datetime.date.today().isoformat(),
        "note": "cheat-sheet block -> Subject A questions (cluster representatives), most repeated first",
        "blocks": {bid: sorted(m, key=lambda r: most_repeated(r, clusters)) for bid, m in members.items()},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")

    covered = set().union(*members.values())
    print(f"{OUT.relative_to(ROOT)}: {len(covered)} of {len(clusters)} questions in {len(P)} blocks"
          f" (cited {sum(v == 'cited' for m in members.values() for v in m.values())},"
          f" semantic {semantic})")
    for sid, title, blocks in sections:
        reps = set().union(*(members[b[0]] for b in blocks))
        print(f"  {sid:9} {len(reps):4}  " + " ".join(f"{b[0].split('-', 1)[1]}={len(members[b[0]])}" for b in blocks))

    if args.report:
        lines = [f"# Вопросы по блокам шпаргалки · {out['generated']}", ""]
        for sid, title, blocks in sections:
            lines.append(f"## {title}")
            for bid, btitle, _, _ in blocks:
                lines += ["", f"### {btitle} · `{bid}` · {len(members[bid])}", "", "| Раз | Вопрос | Как | Текст |", "|---|---|---|---|"]
                for rep in out["blocks"][bid]:
                    stem = re.sub(r"\s+", " ", by_id[rep]["text"])[:110].replace("|", "/")
                    lines.append(f"| {len(clusters[rep])} | {rep} | {members[bid][rep]} | {stem} |")
            lines.append("")
        Path(args.report).write_text("\n".join(lines), "utf-8")


if __name__ == "__main__":
    main()
