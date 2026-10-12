"""Email the result of an ingest run: a summary in the subject, the details and the retry
and failure log in the body, the log attached.

Reads logs/ingest_summary.txt, logs/ingest_run.log (everything the run printed) and
logs/ingest_errors.log (retries and failures only) (written by ingest/av_ingest.py) and
sends with Python's standard library only. Settings are environment variables (GitHub secrets):
  SMTP_USER, SMTP_PASSWORD, REPORT_TO   required; without them this prints a note and does nothing
  SMTP_HOST   default smtp.gmail.com     SMTP_PORT   default 465 (587 uses STARTTLS)
  REPORT_FROM default SMTP_USER
  RUN_URL, RUN_EVENT                    optional, shown in the email
"""
import os
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

LOG_DIR = Path(os.getenv("LOG_DIR") or "logs")
MAX_LOG_LINES_IN_BODY = 150


def read(path):
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def parse_summary(text):
    """key: value lines -> dict; every 'error:' line goes into a list."""
    fields, errors = {}, []
    for line in text.splitlines():
        key, _, value = line.partition(": ")
        if key == "error":
            errors.append(value)
        elif key:
            fields.setdefault(key, value)
    fields["error_list"] = errors
    return fields


def build_message(summary_text, log_text, sender, to, run_url="", event="", run_log_text=""):
    f = parse_summary(summary_text)
    how = f" ({event})" if event else ""
    if "status" in f:
        subject = (f"stamperCapital ingest {f['status'].upper()}: {f.get('api_calls', '?')} calls, "
                   f"{f.get('minutes', '?')} min, {f.get('errors', '?')} errors{how}")
    else:
        subject = f"stamperCapital ingest: no summary was written, the run may have crashed{how}"

    log_lines = [l for l in log_text.splitlines() if l.strip()]
    shown = log_lines[:MAX_LOG_LINES_IN_BODY]
    body = [subject, ""]
    if run_url:
        body += [f"Run: {run_url}", ""]
    body += ["SUMMARY"] + [f"  {k}: {f[k]}" for k in ("status", "started", "minutes", "api_calls", "tickers", "jobs", "errors") if k in f]
    names = [n for n in f.get("statements_refreshed", "").split(", ") if n and n != "none"]
    more = f" ... and {len(names) - 40} more" if len(names) > 40 else ""
    body += ["", "WHAT WAS UPDATED"]
    if "done" in f:
        body.append(f"  jobs completed (tickers each): {f['done']}")
    body.append(f"  new financial statements for {len(names)} companies: {', '.join(names[:40]) or 'none'}{more}")
    if "no_data_tickers" in f:
        body.append(f"  tickers with no company data (prices and quotes only): {f['no_data_tickers']}")
    body += ["", "ERRORS THAT SURVIVED ALL RETRIES (these were skipped and are tried again next run)"]
    body += [f"  {e}" for e in f["error_list"]] or ["  none"]
    body += ["", f"RETRIES AND FAILURES ({len(log_lines)} lines)"]
    body += [f"  {l}" for l in shown] or ["  none: nothing needed a retry"]
    if len(log_lines) > len(shown):
        body.append(f"  ... {len(log_lines) - len(shown)} more lines in the attached log")

    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, sender, to
    msg.set_content("\n".join(body) + "\n")
    for text, name in ((run_log_text, "ingest_run.log"), (log_text, "ingest_errors.log")):
        if text.strip():
            msg.add_attachment(text.encode("utf-8"), maintype="text", subtype="plain", filename=name)
    return msg


def send(msg, host, port, user, password):
    if port == 587:
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.starttls()
            s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP_SSL(host, port, timeout=30) as s:
            s.login(user, password)
            s.send_message(msg)


def main():
    user, password, to = os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD"), os.getenv("REPORT_TO")
    if not (user and password and to):
        print("Email report not set up (SMTP_USER, SMTP_PASSWORD and REPORT_TO secrets); skipping.")
        return 0
    host = os.getenv("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.getenv("SMTP_PORT") or 465)
    msg = build_message(read(LOG_DIR / "ingest_summary.txt"), read(LOG_DIR / "ingest_errors.log"),
                        os.getenv("REPORT_FROM") or user, to,
                        os.getenv("RUN_URL", ""), os.getenv("RUN_EVENT", ""),
                        read(LOG_DIR / "ingest_run.log"))
    try:
        send(msg, host, port, user, password)
    except Exception as e:  # never print the password; the message alone is enough to diagnose
        print(f"Could not send the report email via {host}:{port}: {type(e).__name__}: {e}")
        return 1
    print(f"Report emailed to {to}: {msg['Subject']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
