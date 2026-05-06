api.controller = function($scope) {

    // =========================================================
    // Controller, Formularzustand und UI-Status
    // =========================================================

    var c = this;

    c.form = {
        customer_id:   "",
        meter_id:      "",
        reading_value: "",
        reading_date:  ""
    };

    c.busy           = false;
    c.statusMessage  = "";
    c.statusType     = "";
    c.correlationId  = "";
    c.submitSuccess  = false;

    c.fieldTouched = {
        customer_id:   false,
        meter_id:      false,
        reading_value: false,
        reading_date:  false
    };


    // =========================================================
    // Konfiguration – Werte synchron zum Server-Script halten
    // =========================================================

    c.maxReadingAgeDays = 14;

    c.customerIdMinLength = 5;
    c.customerIdMaxLength = 8;

    c.meterIdMinLength = 5;
    c.meterIdMaxLength = 32;
    c.meterIdCharset   = "extended";   // "extended" | "strict"

    c.readingValueMinDigits = 1;
    c.readingValueMaxDigits = 6;

    // Datumslimits – initial gesetzt, beim Submit aktualisiert.
    refreshDateLimits();


    // =========================================================
    // Hilfsfunktionen für Datumsverwaltung
    // =========================================================

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    function formatDateLocal(dateObj) {
        if (!dateObj) { return ""; }
        return dateObj.getFullYear() + "-" + pad2(dateObj.getMonth() + 1) + "-" + pad2(dateObj.getDate());
    }

    // Konvertiert verschiedene Datumsformate zu YYYY-MM-DD
    function toYmd(value) {
        if (!value) { return ""; }
        if (typeof value === "string") { return value; }
        return formatDateLocal(new Date(value));
    }

    // Aktualisiert heute-Datum und Minimaldatum für die Datumsauswahl
    // WICHTIG: Dies wird aufgerufen vor dem Submit, um über Mitternacht hinweg korrekt zu bleiben.
    function refreshDateLimits() {
        c.today = formatDateLocal(new Date());
        var min = new Date();
        min.setDate(min.getDate() - c.maxReadingAgeDays);
        c.minDate = formatDateLocal(min);
    }

    function clearMessages() {
        c.statusMessage = "";
        c.statusType    = "";
        c.correlationId = "";
    }

    function showError(message, correlationId) {
        c.statusMessage = message || "Übermittlung fehlgeschlagen.";
        c.statusType    = "err";
        c.correlationId = correlationId || "";
    }

    function showSuccess(message, correlationId) {
        c.statusMessage = message || "Erfolgreich übermittelt.";
        c.statusType    = "ok";
        c.correlationId = correlationId || "";
        c.submitSuccess = true;
    }


    // =========================================================
    // Validierung – Komfortprüfung, Server bleibt verbindlich
    // =========================================================

    function isValidCustomerId(value) {
        var pattern = new RegExp("^\\d{" + c.customerIdMinLength + "," + c.customerIdMaxLength + "}$");
        return pattern.test(String(value || "").trim());
    }

    function isValidMeterId(value) {
        var raw = String(value || "").trim();
        if (!raw || raw.length < c.meterIdMinLength || raw.length > c.meterIdMaxLength) {
            return false;
        }
        var pattern = c.meterIdCharset === "extended"
            ? /^[A-Za-z0-9 \-_.\/]+$/
            : /^[A-Za-z0-9 ]+$/;
        return pattern.test(raw);
    }

    function isValidReadingValue(value) {
        var pattern = new RegExp("^\\d{" + c.readingValueMinDigits + "," + c.readingValueMaxDigits + "}$");
        return pattern.test(String(value || "").trim());
    }

    function isValidReadingDate(value) {
        var raw = toYmd(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) { return false; }
        if (raw > c.today) { return false; }
        return raw >= c.minDate;
    }


    // =========================================================
    // Payload und Gesamtprüfung
    // =========================================================

    function getPayload() {
        return {
            customer_id:   String(c.form.customer_id   || "").trim(),
            meter_id:      String(c.form.meter_id      || "").trim(),
            reading_value: String(c.form.reading_value || "").trim(),
            reading_date:  toYmd(c.form.reading_date)
        };
    }

    function validatePayload(payload) {
        if (!isValidCustomerId(payload.customer_id)) {
            return "Kundennummer muss " + c.customerIdMinLength + "-" + c.customerIdMaxLength + " Ziffern enthalten.";
        }
        if (!isValidMeterId(payload.meter_id)) {
            return "Zählernummer muss " + c.meterIdMinLength + "-" + c.meterIdMaxLength + " Zeichen lang sein.";
        }
        if (!isValidReadingValue(payload.reading_value)) {
            return "Zählerstand muss " + c.readingValueMinDigits + "-" + c.readingValueMaxDigits + " Ziffern enthalten.";
        }

        if (!isValidReadingDate(payload.reading_date)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.reading_date)) {
                return "Bitte ein gültiges Ablesedatum auswählen.";
            }
            if (payload.reading_date > c.today) {
                return "Das Ablesedatum darf nicht in der Zukunft liegen.";
            }
            return "Das Ablesedatum ist zu weit in der Vergangenheit (maximal " + c.maxReadingAgeDays + " Tage).";
        }
        return "";
    }


    // =========================================================
    // UI-Verhalten
    // =========================================================

    c.markTouched = function(fieldName) {
        c.fieldTouched[fieldName] = true;
    };

    c.hasFieldError = function(fieldName) {
        if (!c.fieldTouched[fieldName]) { return false; }
        if (fieldName === "customer_id")   { return !isValidCustomerId(c.form.customer_id); }
        if (fieldName === "meter_id")      { return !isValidMeterId(c.form.meter_id); }
        if (fieldName === "reading_value") { return !isValidReadingValue(c.form.reading_value); }
        if (fieldName === "reading_date")  { return !isValidReadingDate(toYmd(c.form.reading_date)); }
        return false;
    };


    // =========================================================
    // Reset
    // =========================================================

    c.reset = function() {
        c.form = {
            customer_id:   "",
            meter_id:      "",
            reading_value: "",
            reading_date:  ""
        };
        c.busy          = false;
        c.submitSuccess = false;
        c.fieldTouched = {
            customer_id:   false,
            meter_id:      false,
            reading_value: false,
            reading_date:  false
        };
        clearMessages();
        refreshDateLimits();
    };


    // =========================================================
    // Übermittlung – mit angemessenem Error Handling
    // =========================================================

    c.submit = function() {
        if (c.busy) { return; }

        clearMessages();
        refreshDateLimits();   // Sicherstellen, dass Daten über Mitternacht korrekt sind

        c.fieldTouched.customer_id   = true;
        c.fieldTouched.meter_id      = true;
        c.fieldTouched.reading_value = true;
        c.fieldTouched.reading_date  = true;

        var payload = getPayload();
        var validationError = validatePayload(payload);
        if (validationError) {
            showError(validationError, "");
            return;
        }

        c.busy = true;

        c.server.get({
            action:  "submit",
            payload: payload
        }).then(function(response) {
            var res = response.data || {};
            if (res.ok) {
                showSuccess(res.message, res.correlation_id);
                // Nach erfolgreichem Submit das Formular zurücksetzen
                // (Der Benutzer sieht die Erfolgsmeldung und kann dann eine neue Meldung erfassen)
            } else {
                showError(res.message || "Übermittlung fehlgeschlagen.", res.correlation_id || "");
            }
        }).catch(function(error) {
            console.error("Submit failed:", error);
            showError("Übermittlung konnte nicht abgeschlossen werden. Bitte versuchen Sie es später erneut.", "");
        }).finally(function() {
            c.busy = false;
        });
    };

};