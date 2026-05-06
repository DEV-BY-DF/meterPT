(function() {

    // =========================================================
    // Konfiguration – hier alle anpassbaren Werte zentral ändern
    // =========================================================

    // =========================================================
    // Konfigurationskonstanten – MÜSSEN mit meter_processing_SI synchron sein!
    // =========================================================
    var STAGING_TABLE              = "u_meter_reading_staging";
    var STATUS_RECEIVED            = "received";
    var STATUS_FAILED              = "failed";
    var MAX_READING_AGE_DAYS       = 14;     // Rückwärtsgrenze für Ablesedaten (Tage)
    var DELETE_AFTER_DAYS          = 28;     // Aufbewahrungsfrist Fallback
    var METER_ID_MIN_LENGTH        = 5;      // Zählernummer Mindestlänge
    var METER_ID_MAX_LENGTH        = 32;     // Zählernummer Maximallänge
    var METER_ID_CHARSET           = "extended";  // "strict" | "extended" (mit -, _, ., /)
    var CUSTOMER_ID_MIN_LENGTH     = 5;      // Kundennummer Mindestlänge
    var CUSTOMER_ID_MAX_LENGTH     = 8;      // Kundennummer Maximallänge
    var READING_VALUE_MIN_DIGITS   = 1;      // Zählerstand Mindestziffern
    var READING_VALUE_MAX_DIGITS   = 6;      // Zählerstand Maximalziffern
    var ENABLE_EXTERNAL_VALIDATION = false;  // Externe Fachvalidierung aktivieren


    // =========================================================
    // Grundzustand und Request-Prüfung
    // =========================================================

    data.ok = false;

    if (!input || input.action !== "submit") {
        data.message = "Ungültiger Request.";
        return;
    }

    var correlationId = gs.generateGUID();


    // =========================================================
    // Antwort-Helfer
    // =========================================================

    function reply(ok, message) {
        data.ok             = ok;
        data.message        = message;
        data.correlation_id = correlationId;
    }
    function replyBad(msg) { reply(false, msg); }
    function replyOk(msg)  { reply(true,  msg); }


    // =========================================================
    // Regex-Pattern-Cache (ein Mal erzeugen statt bei jeder Validierung)
    // =========================================================
    var PATTERN_CUSTOMER_ID     = new RegExp("^\\d{" + CUSTOMER_ID_MIN_LENGTH + "," + CUSTOMER_ID_MAX_LENGTH + "}$");
    var PATTERN_READING_VALUE   = new RegExp("^\\d{" + READING_VALUE_MIN_DIGITS + "," + READING_VALUE_MAX_DIGITS + "}$");
    var PATTERN_DATE_FORMAT     = /^\d{4}-\d{2}-\d{2}$/;
    var PATTERN_METER_EXTENDED  = /^[A-Za-z0-9 \-_.\/]+$/;
    var PATTERN_METER_STRICT    = /^[A-Za-z0-9 ]+$/;

    // =========================================================
    // Validierungs-Hilfsfunktionen
    // =========================================================

    // Whitelist für Zählernummer – Modus per METER_ID_CHARSET steuerbar.
    function isValidMeterId(value) {
        var raw = String(value || "").trim();
        if (raw.length < METER_ID_MIN_LENGTH || raw.length > METER_ID_MAX_LENGTH) {
            return false;
        }
        var pattern = METER_ID_CHARSET === "extended" ? PATTERN_METER_EXTENDED : PATTERN_METER_STRICT;
        return pattern.test(raw);
    }

    // Format YYYY-MM-DD: nicht in Zukunft, nicht älter als MAX_READING_AGE_DAYS.
    function isValidReadingDate(dateValue) {
        var raw = String(dateValue || "").trim();
        if (!PATTERN_DATE_FORMAT.test(raw)) { return false; }

        var inputGdt = new GlideDateTime(raw + " 00:00:00");
        var now      = new GlideDateTime();

        if (inputGdt.getNumericValue() > now.getNumericValue()) { return false; }

        var oldest = new GlideDateTime();
        oldest.addDaysUTC(-MAX_READING_AGE_DAYS);
        return inputGdt.getNumericValue() >= oldest.getNumericValue();
    }

    // Validiert ob bereits ein Datensatz mit dieser Kombination existiert (Status != failed)
    function hasDuplicateSubmission(customerId, meterId, readingDate) {
        var gr = new GlideRecord(STAGING_TABLE);
        gr.addQuery("u_customer_id",  customerId);
        gr.addQuery("u_meter_id",     meterId);
        gr.addQuery("u_reading_date", readingDate);
        gr.addQuery("u_status",       "!=", STATUS_FAILED);
        gr.setLimit(1);
        gr.query();
        return gr.next();
    }

    // Race-Condition-Check NACH Insert: Existiert ein älterer Datensatz mit gleicher Kombination?
    // Falls ja: Dieser Insert verliert den Race – eigenen Datensatz auf failed setzen.
    // → at-least-once Semantik: Ältester Insert gewinnt, Duplikate werden verworfen.
    function isRaceLoser(ownSysId, customerId, meterId, readingDate) {
        var gr = new GlideRecord(STAGING_TABLE);
        gr.addQuery("u_customer_id",  customerId);
        gr.addQuery("u_meter_id",     meterId);
        gr.addQuery("u_reading_date", readingDate);
        gr.addQuery("u_status",       "!=", STATUS_FAILED);
        gr.addQuery("sys_id",         "!=", ownSysId);
        gr.addQuery("sys_created_on", "<=", new GlideDateTime());
        gr.orderBy("sys_created_on");
        gr.setLimit(1);
        gr.query();
        return gr.next();
    }

    // delete_after-Berechnung mit sauberem Fallback, falls meter_processing fehlt.
    function computeDeleteAfter() {
        try {
            return new meter_processing().getDeleteAfterDateTime();
        } catch (e) {
            var gdt = new GlideDateTime();
            gdt.addDaysUTC(DELETE_AFTER_DAYS);
            return gdt;
        }
    }


// =========================================================
// Verarbeitung
// =========================================================

try {
    var p = input.payload || {};

    var customerId      = String(p.customer_id   || "").trim();
    var meterId         = String(p.meter_id      || "").trim();
    var readingValue    = String(p.reading_value || "").trim();
    var readingDate     = String(p.reading_date  || "").trim();

    // Pflichtprüfungen
    if (!PATTERN_CUSTOMER_ID.test(customerId)) {
        return replyBad("Kundennummer muss " + CUSTOMER_ID_MIN_LENGTH + "-" + CUSTOMER_ID_MAX_LENGTH + " Ziffern enthalten.");
    }

    if (!isValidMeterId(meterId)) {
        return replyBad("Zählernummer ungültig.");
    }

    if (!PATTERN_READING_VALUE.test(readingValue)) {
        return replyBad("Zählerstand muss " + READING_VALUE_MIN_DIGITS + "-" + READING_VALUE_MAX_DIGITS + " Ziffern enthalten.");
    }

    if (!isValidReadingDate(readingDate)) {
        return replyBad("Ablesedatum ungültig oder nicht im Zeitraum der letzten " + MAX_READING_AGE_DAYS + " Tage.");
    }

    if (hasDuplicateSubmission(customerId, meterId, readingDate)) {
        return replyBad("Für diese Kombination liegt bereits eine Meldung vor.");
    }

    // Optionale externe Fachvalidierung
    if (ENABLE_EXTERNAL_VALIDATION) {
        try {
            var validation = new meter_external_validation()
                .validateCustomerMeterCombination(customerId, meterId, "");

            if (!validation || !validation.ok) {
                gs.warn(
                    "METER_WIDGET external validation failed" +
                    " | correlation_id=" + correlationId +
                    " | customer_id=" + customerId +
                    " | meter_id=" + meterId +
                    " | message=" + (validation && validation.message ? validation.message : "")
                );

                return replyBad(
                    validation && validation.message
                        ? validation.message
                        : "Externe Validierung fehlgeschlagen."
                );
            }
        } catch (valError) {
            gs.warn(
                "METER_WIDGET external validation exception" +
                " | correlation_id=" + correlationId +
                " | error=" + valError
            );

            return replyBad("Externe Validierung nicht verfügbar.");
        }
    }

    // Staging-Datensatz anlegen
    var gr = new GlideRecord(STAGING_TABLE);
    gr.initialize();
    gr.setValue("u_customer_id", customerId);
    gr.setValue("u_meter_id", meterId);
    gr.setValue("u_reading_value", readingValue);
    gr.setValue("u_reading_date", readingDate);
    gr.setValue("u_status", STATUS_RECEIVED);
    gr.setValue("u_correlation_id", correlationId);
    gr.setValue("u_error_message", "");
    gr.setValue("u_delete_after", computeDeleteAfter());

    var sysId = gr.insert();

    if (!sysId) {
        gs.error("METER_WIDGET insert failed | correlation_id=" + correlationId);
        return replyBad("Datensatz konnte nicht gespeichert werden.");
    }

    // Race-Condition: zweiter, gleichzeitiger Submit derselben Kombination?
    if (isRaceLoser(sysId, customerId, meterId, readingDate)) {
        var loser = new GlideRecord(STAGING_TABLE);

        if (loser.get(sysId)) {
            loser.setValue("u_status", STATUS_FAILED);
            loser.setValue("u_error_message", "Duplikat erkannt: Ein älterer Datensatz für diese Kombination existiert bereits.");
            loser.update();
        }

        gs.warn(
            "METER_WIDGET race condition detected" +
            " | sys_id=" + sysId +
            " | customer_id=" + customerId +
            " | meter_id=" + meterId +
            " | date=" + readingDate +
            " | correlation_id=" + correlationId
        );

        return replyBad("Für diese Kombination liegt bereits eine Meldung vor.");
    }

    gs.info(
        "METER_WIDGET insert ok" +
        " | sys_id=" + sysId +
        " | customer_id=" + customerId +
        " | meter_id=" + meterId +
        " | correlation_id=" + correlationId
    );

    return replyOk("Zählerstand erfolgreich übermittelt.");

} catch (e) {
    gs.error(
        "METER_WIDGET error" +
        " | correlation_id=" + correlationId +
        " | error=" + e
    );

    return replyBad("Übermittlung fehlgeschlagen. Bitte später erneut versuchen.");
}

})();