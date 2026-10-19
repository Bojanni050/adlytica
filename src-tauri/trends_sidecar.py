"""Adlytica Google Trends sidecar.

Minimal JSON-RPC-over-stdin/stdout server using pytrends.
Protocol: one JSON request per line on stdin -> one JSON response per line on stdout.
"""

import sys
import json


def handle_interest_over_time(req):
    from pytrends.request import TrendReq

    keywords = req.get("keywords", [])
    timeframe = req.get("timeframe", "today 12-m")
    geo = req.get("geo", "NL")

    pytrends = TrendReq(hl="nl-NL", tz=60)
    try:
        pytrends.build_payload(keywords, timeframe=timeframe, geo=geo)
        df = pytrends.interest_over_time()
    except Exception as e:
        raise RuntimeError(
            f"Google Trends weigerde het verzoek ({e}). "
            "Dit komt vaak door rate-limiting of IP-blokkade; probeer het over enkele minuten opnieuw."
        ) from e
    if df.empty:
        return {"points": []}
    if "isPartial" in df.columns:
        df = df.drop(columns=["isPartial"])
    points = [
        {"date": str(idx.date()), "values": {kw: (None if kw not in row or row[kw] != row[kw] else int(row[kw])) for kw in df.columns}}
        for idx, (_, row) in enumerate(df.iterrows())
    ]
    return {"points": points}


def handle_related_queries(req):
    from pytrends.request import TrendReq

    keywords = req.get("keywords", [])
    timeframe = req.get("timeframe", "today 12-m")
    geo = req.get("geo", "NL")

    pytrends = TrendReq(hl="nl-NL", tz=60)
    try:
        pytrends.build_payload(keywords, timeframe=timeframe, geo=geo)
        payload = pytrends.related_queries()
    except Exception as e:
        raise RuntimeError(
            f"Google Trends weigerde het verzoek ({e}). "
            "Dit komt vaak door rate-limiting of IP-blokkade; probeer het over enkele minuten opnieuw."
        ) from e
    out = {}
    for kw, data in payload.items():
        for rank, df in (data or {}).items():
            if df is None:
                continue
            out.setdefault(kw, {})[rank] = df.to_dict(orient="records")
    return out


HANDLERS = {
    "interest_over_time": handle_interest_over_time,
    "related_queries": handle_related_queries,
}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            handler = HANDLERS.get(req.get("method", ""))
            if handler is None:
                resp = {"error": f"Onbekende methode: {req.get('method')}"}
            else:
                resp = handler(req.get("params", {}))
        except Exception as e:
            resp = {"error": f"{type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(resp, default=str) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
