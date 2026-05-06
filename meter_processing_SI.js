var meter_processing = Class.create();
meter_processing.prototype = {

    initialize: function() {
        this.STAGING_TABLE = "u_meter_reading_staging";
        this.EXPORT_TABLE  = "u_meter_export";

        this.MODE        = "TXT";
        this.FILE_PREFIX = "meter_export_";

        this.STATUS_RECEIVED  = "received";
        this.STATUS_FORWARDED = "forwarded";
        this.STATUS_FAILED    = "failed";
        this.STATUS_CREATED   = "created";

        // =========================================================
        // Konfigurationskonstanten – MÜSSEN mit Widget_Server.js synchron sein!
        // =========================================================
        this.MAX_READING_AGE_DAYS = 14;   // Rückwärtsgrenze für Ablesedaten (Tage)
        this.DELETE_AFTER_DAYS    = 28;   // Aufbewahrungsfrist für Staging und Export

        this.CUSTOMER_ID_MIN_LENGTH   = 5;
        this.CUSTOMER_ID_MAX_LENGTH   = 8;
        this.METER_ID_MIN_LENGTH      = 5;
        this.METER_ID_MAX_LENGTH      = 32;
        this.METER_ID_CHARSET         = "extended"; // "extended" (A-Z 0-9 - _ . / Leerzeichen) | "strict"
        this.READING_VALUE_MIN_DIGITS = 1;
        this.READING_VALUE_MAX_DIGITS = 6;
    },


    // =========================================================
    // Haupteinstieg
    // =========================================================

    processRecord: function(recordSysId) {
        var result = {
            ok: false, message: "", file_name: "",
            attachment_id: "", export_sys_id: "", count: 0
        };
        var rec = null;

        try {
            if (!recordSysId) {
                result.message = "Keine Datensatz-ID übergeben.";
                return result;
            }

            rec = new GlideRecord(this.STAGING_TABLE);
            if (!rec.get(recordSysId)) {
                result.message = "Datensatz nicht gefunden.";
                return result;
            }

            if (String(rec.getValue("u_status") || "") !== this.STATUS_RECEIVED) {
                result.message = "Datensatz ist nicht im Status 'received'.";
                return result;
            }

            var mapped     = this.mapRecord(rec);
            var validation = this.validateRecord(mapped);
            if (!validation.ok) {
                this.markStagingFailed(rec, validation.message);
                result.message = validation.message;
                return result;
            }

            var payload = this.buildTxtPayload([mapped]);
            if (!payload) {
                this.markStagingFailed(rec, "Leerer Export-Payload erzeugt.");
                result.message = "Leerer Export-Payload erzeugt.";
                return result;
            }

            var sendResult = this.sendToTarget(payload, rec);
            if (!sendResult.ok) {
                this.markStagingFailed(rec, sendResult.message || "Verarbeitung fehlgeschlagen.");
                result.message = sendResult.message || "Verarbeitung fehlgeschlagen.";
                return result;
            }

            rec.setValue("u_status",        this.STATUS_FORWARDED);
            rec.setValue("u_error_message", "");
            rec.update();

            result.ok            = true;
            result.message       = "Verarbeitung erfolgreich.";
            result.file_name     = sendResult.file_name     || "";
            result.attachment_id = sendResult.attachment_id || "";
            result.export_sys_id = sendResult.export_sys_id || "";
            result.count         = 1;
            return result;

        } catch (e) {
            gs.error("meter_processing.processRecord ERROR: " + e);
            if (rec && rec.isValidRecord()) {
                this.markStagingFailed(rec, "Serverfehler bei der Verarbeitung.");
            }
            result.message = "Serverfehler bei der Verarbeitung.";
            return result;
        }
    },

    markStagingFailed: function(rec, message) {
        if (!rec || !rec.isValidRecord()) { return; }
        rec.setValue("u_status",        this.STATUS_FAILED);
        rec.setValue("u_error_message", String(message || "Verarbeitung fehlgeschlagen."));
        rec.update();
    },

    mapRecord: function(gr) {
        return {
            sys_id:         String(gr.getUniqueValue()             || ""),
            customer_id:    String(gr.getValue("u_customer_id")    || "").trim(),
            meter_id:       String(gr.getValue("u_meter_id")       || "").trim(),
            reading_value:  String(gr.getValue("u_reading_value")  || "").trim(),
            reading_date:   String(gr.getValue("u_reading_date")   || "").trim(),
            correlation_id: String(gr.getValue("u_correlation_id") || "").trim()
        };
    },


    // =========================================================
    // Validierung
    // =========================================================

    validateRecord: function(record) {
        if (!record.customer_id)   { return { ok: false, message: "Kundennummer fehlt." }; }
        if (!record.meter_id)      { return { ok: false, message: "Zählernummer fehlt." }; }
        if (!record.reading_value) { return { ok: false, message: "Zählerstand fehlt." }; }
        if (!record.reading_date)  { return { ok: false, message: "Ablesedatum fehlt." }; }

        var customerPattern = new RegExp(
            "^\\d{" + this.CUSTOMER_ID_MIN_LENGTH + "," + this.CUSTOMER_ID_MAX_LENGTH + "}$"
        );
        if (!customerPattern.test(record.customer_id)) {
            return { ok: false, message: "Kundennummer ist ungültig." };
        }

        if (!this.isValidMeterId(record.meter_id)) {
            return { ok: false, message: "Zählernummer ist ungültig." };
        }

        if (!this.isValidReadingValue(record.reading_value)) {
            return { ok: false, message: "Zählerstand ist ungültig." };
        }

        return this.validateReadingDate(record.reading_date);
    },

    // Whitelist-Regex identisch zu Widget_Server.js und Widget_Client.js.
    // METER_ID_CHARSET "extended": A-Z a-z 0-9 Leerzeichen - _ . /
    // METER_ID_CHARSET "strict":   A-Z a-z 0-9 Leerzeichen
    isValidMeterId: function(value) {
        var raw = String(value || "").trim();
        if (!raw ||
            raw.length < this.METER_ID_MIN_LENGTH ||
            raw.length > this.METER_ID_MAX_LENGTH) {
            return false;
        }
        var pattern = this.METER_ID_CHARSET === "extended"
            ? /^[A-Za-z0-9 \-_.\/]+$/
            : /^[A-Za-z0-9 ]+$/;
        return pattern.test(raw);
    },

    isValidReadingValue: function(value) {
        var pattern = new RegExp(
            "^\\d{" + this.READING_VALUE_MIN_DIGITS + "," + this.READING_VALUE_MAX_DIGITS + "}$"
        );
        return pattern.test(String(value || "").trim());
    },

    validateReadingDate: function(dateValue) {
        var raw = String(dateValue || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            return { ok: false, message: "Ablesedatum hat kein gültiges Format." };
        }

        var inputGdt = new GlideDateTime(raw + " 00:00:00");
        var now      = new GlideDateTime();

        if (inputGdt.getNumericValue() > now.getNumericValue()) {
            return { ok: false, message: "Ablesedatum darf nicht in der Zukunft liegen." };
        }

        var oldest = new GlideDateTime();
        oldest.addDaysUTC(-this.MAX_READING_AGE_DAYS);
        if (inputGdt.getNumericValue() < oldest.getNumericValue()) {
            return { ok: false, message: "Ablesedatum ist zu weit in der Vergangenheit." };
        }

        return { ok: true, message: "" };
    },


    // =========================================================
    // TXT-Formatierung und Export
    // =========================================================

    formatDateToDDMMYY: function(dateValue) {
        var parts = String(dateValue || "").trim().split("-");
        if (parts.length !== 3) { return ""; }
        return parts[2] + parts[1] + parts[0].substring(2, 4);
    },

    wrap: function(value) {
        return "^" + String(value || "") + "^";
    },

    buildLine: function(customerId, prefix, meterId, readingValue, readingDate) {
        return [
            this.wrap(customerId),
            this.wrap(prefix),
            this.wrap(meterId),
            this.wrap(readingValue),
            this.wrap(readingDate)
        ].join(",");
    },

    buildTxtPayload: function(records) {
        var lines = [];
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            lines.push(this.buildLine(
                r.customer_id,
                "",
                r.meter_id,
                r.reading_value,
                this.formatDateToDDMMYY(r.reading_date)
            ));
        }
        return lines.join("\n");
    },

    buildFileName: function() {
        var gdt = new GlideDateTime();
        return this.FILE_PREFIX +
               gdt.getDate().getByFormat("yyyyMMdd") + "_" +
               gdt.getTime().getByFormat("HHmmss") + ".txt";
    },

    sendToTarget: function(payload, stagingRec) {
        if (this.MODE === "TXT") { return this.writeTxtAttachment(payload, stagingRec); }
        if (this.MODE === "API") { return this.sendToApi(payload, stagingRec); }
        return { ok: false, message: "Kein gültiger Verarbeitungsmodus konfiguriert." };
    },

    writeTxtAttachment: function(payload, stagingRec) {
        var result = {
            ok: false, message: "", file_name: "",
            attachment_id: "", export_sys_id: ""
        };
        var exportSysId;

        try {
            var fileName  = this.buildFileName();
            var exportRec = new GlideRecord(this.EXPORT_TABLE);
            exportRec.initialize();
            exportRec.setValue("u_status",         this.STATUS_CREATED);
            exportRec.setValue("u_file_name",      fileName);
            exportRec.setValue("u_delete_after",   this.getDeleteAfterDateTime());
            exportRec.setValue("u_source_staging", stagingRec.getUniqueValue());
            exportRec.setValue("u_error_message",  "");

            exportSysId = exportRec.insert();
            if (!exportSysId) {
                result.message = "Export-Datensatz konnte nicht angelegt werden.";
                return result;
            }

            if (!exportRec.get(exportSysId)) {
                result.message = "Export-Datensatz konnte nicht erneut geladen werden.";
                return result;
            }

            var attachmentId = new GlideSysAttachment().write(
                exportRec, fileName, "text/plain", String(payload)
            );

            if (!attachmentId) {
                exportRec.setValue("u_status",        this.STATUS_FAILED);
                exportRec.setValue("u_error_message", "Attachment konnte nicht erzeugt werden.");
                exportRec.update();
                result.message = "Attachment konnte nicht erzeugt werden.";
                return result;
            }

            exportRec.setValue("u_attachment_id", String(attachmentId));
            exportRec.setValue("u_error_message", "");
            exportRec.update();

            result.ok            = true;
            result.message       = "TXT erfolgreich erzeugt.";
            result.file_name     = fileName;
            result.attachment_id = String(attachmentId);
            result.export_sys_id = String(exportSysId);

            gs.info("meter_processing TXT erstellt | export_sys_id=" + exportSysId +
                    " | file=" + fileName + " | attachment_id=" + attachmentId);
            return result;

        } catch (e) {
            gs.error("meter_processing.writeTxtAttachment ERROR: " + e);
            if (exportSysId) {
                var failRec = new GlideRecord(this.EXPORT_TABLE);
                if (failRec.get(exportSysId)) {
                    failRec.setValue("u_status",        this.STATUS_FAILED);
                    failRec.setValue("u_error_message", "Fehler bei der Attachment-Erzeugung.");
                    failRec.update();
                }
            }
            result.message = "TXT-Erzeugung fehlgeschlagen.";
            return result;
        }
    },

    getDeleteAfterDateTime: function() {
        var gdt = new GlideDateTime();
        gdt.addDaysUTC(this.DELETE_AFTER_DAYS);
        return gdt;
    },

    sendToApi: function(payload, stagingRec) {
        return { ok: false, message: "API-Modus ist aktuell nicht aktiv." };
    },


    // =========================================================
    // Löschung abgelaufener Staging-Datensätze
    // =========================================================

    // Filtert auf u_delete_after – das Feld wird beim Insert vom Widget-Server gesetzt
    // und steuert die individuelle Aufbewahrungsfrist pro Datensatz.
    deleteExpiredStaging: function() {
        var result = { ok: true, deleted_staging: 0 };
        try {
            var now = new GlideDateTime();
            var gr  = new GlideRecord(this.STAGING_TABLE);
            gr.addQuery("u_delete_after", "<=", now);
            gr.query();

            while (gr.next()) {
                gr.deleteRecord();
                result.deleted_staging++;
            }
        } catch (e) {
            gs.error("meter_processing.deleteExpiredStaging ERROR: " + e);
            result.ok = false;
        }
        return result;
    },

    type: "meter_processing"
};