#!/usr/bin/env python3
"""
ArchIA — Servidor local de análisis
Arranca este script antes de usar el portal web.
Requiere: pip install flask boto3 flask-cors

Uso:
  python archia_server.py
  (el portal web llama a http://localhost:8000)

Variables de entorno necesarias (o edita CONFIGURACION más abajo):
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION
"""

import json
import os
import boto3
from flask import Flask, request, jsonify
from flask_cors import CORS

# ════════════════════════════════════════
# CONFIGURACION — edita aquí los valores que te pase el equipo AWS
# (o ponlos como variables de entorno antes de arrancar)
# ════════════════════════════════════════
AWS_ACCESS_KEY_ID     = os.environ.get("AWS_ACCESS_KEY_ID",     "AKIA_PON_AQUI_TU_KEY")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "pon_aqui_tu_secret")
AWS_REGION            = os.environ.get("AWS_REGION",            "eu-west-1")

# Modelo de Bedrock a usar (Claude 3.5 Sonnet recomendado)
BEDROCK_MODEL = "anthropic.claude-3-5-sonnet-20241022-v2:0"
# Alternativa más económica:
# BEDROCK_MODEL = "anthropic.claude-3-haiku-20240307-v1:0"

PORT = 8000
# ════════════════════════════════════════

app = Flask(__name__)
CORS(app)  # Permite llamadas desde el portal web (localhost o GitHub Pages)

def get_bedrock():
    return boto3.client(
        "bedrock-runtime",
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY
    )

def get_waf():
    return boto3.client(
        "wafv2",
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY
    )


# ── ENDPOINT: analizar evidencia con IA ─────────────────────────────
@app.route("/analyze-evidence", methods=["POST"])
def analyze_evidence():
    """
    Body esperado:
    {
      "controlId":    "SEC-042",
      "controlDesc":  "Descripción del control de seguridad",
      "evidenceText": "Texto extraído del fichero de evidencia",
      "analystNotes": "Notas adicionales del analista (opcional)"
    }
    """
    try:
        body = request.get_json(force=True) or {}
        control_id    = body.get("controlId",    "Sin ID")
        control_desc  = body.get("controlDesc",  "Sin descripción")
        evidence_text = body.get("evidenceText", "").strip()
        analyst_notes = body.get("analystNotes", "").strip()

        if not evidence_text:
            return jsonify({"error": "evidenceText es obligatorio"}), 400

        prompt = f"""Eres un arquitecto de seguridad senior realizando una auditoría de controles de seguridad.

CONTROL A EVALUAR:
- ID: {control_id}
- Descripción: {control_desc}

EVIDENCIA APORTADA POR EL CLIENTE:
{evidence_text}

{"NOTAS DEL ANALISTA:" + chr(10) + analyst_notes if analyst_notes else ""}

Analiza si la evidencia demuestra el cumplimiento del control de seguridad.
Sé objetivo y específico. Cita partes concretas de la evidencia en tus hallazgos.

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta (sin texto adicional antes o después):
{{
  "cumplimiento": "cumple" | "no_cumple" | "parcial",
  "nivel_confianza": "alto" | "medio" | "bajo",
  "resumen": "Una frase concisa con el veredicto",
  "hallazgos": [
    "Hallazgo positivo o negativo concreto 1",
    "Hallazgo positivo o negativo concreto 2"
  ],
  "recomendaciones": [
    "Recomendación concreta si no cumple o es parcial"
  ]
}}"""

        bedrock = get_bedrock()
        response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1024,
                "temperature": 0.1,
                "messages": [{"role": "user", "content": prompt}]
            })
        )
        result_body = json.loads(response["body"].read())
        text = result_body["content"][0]["text"].strip()

        # Extraer JSON de la respuesta
        start = text.find("{")
        end   = text.rfind("}") + 1
        if start < 0:
            return jsonify({"error": "El modelo no devolvió JSON válido", "raw": text}), 500

        analysis = json.loads(text[start:end])
        return jsonify({"analysis": analysis})

    except boto3.exceptions.Boto3Error as e:
        return jsonify({"error": f"Error AWS: {str(e)}"}), 502
    except json.JSONDecodeError as e:
        return jsonify({"error": f"Error parseando respuesta del modelo: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── ENDPOINT: consultar configuración de WAF ─────────────────────────
@app.route("/check-waf", methods=["POST"])
def check_waf():
    """
    Body esperado:
    {
      "wafName": "nombre-del-webacl",
      "wafId":   "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "scope":   "REGIONAL" | "CLOUDFRONT"   (por defecto REGIONAL)
    }

    Para obtener el nombre e ID de tu WAF:
      aws wafv2 list-web-acls --scope REGIONAL --region eu-west-1
    """
    try:
        body     = request.get_json(force=True) or {}
        waf_name = body.get("wafName", "").strip()
        waf_id   = body.get("wafId",   "").strip()
        scope    = body.get("scope",   "REGIONAL").upper()

        if not waf_name or not waf_id:
            return jsonify({"error": "wafName y wafId son obligatorios"}), 400

        waf = get_waf()
        response = waf.get_web_acl(Name=waf_name, Id=waf_id, Scope=scope)
        acl = response["WebACL"]

        # Acción por defecto
        default_action = list(acl.get("DefaultAction", {"Allow": {}}).keys())[0]
        is_blocking    = default_action == "Block"

        # Reglas
        rules = []
        for rule in acl.get("Rules", []):
            if "Action" in rule:
                action = list(rule["Action"].keys())[0]
            elif "OverrideAction" in rule:
                action = "Override:" + list(rule["OverrideAction"].keys())[0]
            else:
                action = "Unknown"

            rules.append({
                "name":     rule["Name"],
                "priority": rule["Priority"],
                "action":   action,
                "blocking": action == "Block"
            })

        rules.sort(key=lambda r: r["priority"])

        blocking_rules    = [r for r in rules if r["blocking"]]
        non_blocking_rules = [r for r in rules if not r["blocking"]]

        result = {
            "name":              acl["Name"],
            "id":                acl["Id"],
            "arn":               acl.get("ARN", ""),
            "description":       acl.get("Description", ""),
            "defaultAction":     default_action,
            "isBlocking":        is_blocking,
            "capacity":          acl.get("Capacity", 0),
            "rulesTotal":        len(rules),
            "rulesBlocking":     len(blocking_rules),
            "rulesNonBlocking":  len(non_blocking_rules),
            "rules":             rules,
            "managedRules":      [r["name"] for r in rules if "AWS" in r["name"] or "Managed" in r["name"]],
            "summary": (
                f"WAF '{acl['Name']}' está en modo {'BLOQUEO' if is_blocking else 'DETECCIÓN (COUNT)'}. "
                f"{len(rules)} reglas configuradas, {len(blocking_rules)} en modo bloqueo."
            )
        }

        return jsonify(result)

    except waf.exceptions.WAFNonexistentItemException:
        return jsonify({"error": f"No se encontró el WAF '{waf_name}' con ID '{waf_id}' en scope {scope}"}), 404
    except boto3.exceptions.Boto3Error as e:
        return jsonify({"error": f"Error AWS: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── ENDPOINT: listar WAFs disponibles ───────────────────────────────
@app.route("/list-wafs", methods=["POST"])
def list_wafs():
    """
    Body esperado:
    {
      "scope": "REGIONAL" | "CLOUDFRONT"   (por defecto REGIONAL)
    }
    Útil para que el usuario pueda buscar el nombre e ID del WAF.
    """
    try:
        body  = request.get_json(force=True) or {}
        scope = body.get("scope", "REGIONAL").upper()

        waf      = get_waf()
        response = waf.list_web_acls(Scope=scope)

        wafs = [
            {"name": w["Name"], "id": w["Id"], "lockToken": w["LockToken"]}
            for w in response.get("WebACLs", [])
        ]
        return jsonify({"scope": scope, "wafs": wafs, "total": len(wafs)})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── ENDPOINT: health check ───────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":  "ok",
        "region":  AWS_REGION,
        "model":   BEDROCK_MODEL,
        "version": "1.0.0"
    })


# ════════════════════════════════════════
if __name__ == "__main__":
    print("=" * 55)
    print("  ArchIA — Servidor local de análisis")
    print("=" * 55)
    print(f"  Región AWS : {AWS_REGION}")
    print(f"  Modelo IA  : {BEDROCK_MODEL}")
    print(f"  Puerto     : {PORT}")
    print()
    print(f"  Health check: http://localhost:{PORT}/health")
    print()

    creds_ok = (
        AWS_ACCESS_KEY_ID     != "AKIA_PON_AQUI_TU_KEY" and
        AWS_SECRET_ACCESS_KEY != "pon_aqui_tu_secret"
    )
    if not creds_ok:
        print("  ⚠  AVISO: Credenciales AWS no configuradas.")
        print("     Edita las variables al inicio del fichero o")
        print("     establece las variables de entorno:")
        print("       AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION")
    else:
        print("  ✓  Credenciales AWS configuradas.")

    print()
    print("  Pulsa Ctrl+C para detener el servidor.")
    print("=" * 55)

    app.run(host="0.0.0.0", port=PORT, debug=False)
