import SwiftUI

// MARK: - TypedReportCreateView

/// Template-driven report creation form. Renders fields dynamically from a
/// `ReportTypeDefinition`. Each field type maps to a native SwiftUI control.
/// Textarea fields with `supportAudioInput: true` show a mic button for
/// speech-to-text dictation.
struct TypedReportCreateView: View {
    let reportType: ReportTypeDefinition
    let onSubmit: (String, [String: AnyCodableValue]) async -> Bool

    @Environment(\.dismiss) private var dismiss

    @State private var fieldValues: [String: AnyCodableValue] = [:]
    @State private var multiselectValues: [String: Set<String>] = [:]
    @State private var dateValues: [String: Date] = [:]
    @State private var isSaving: Bool = false
    @State private var errorMessage: String?

    /// Fields sorted by order, grouped by section.
    private var sortedFields: [ReportFieldDefinition] {
        reportType.fields.sorted { $0.order < $1.order }
    }

    /// Fields grouped by section (nil section = default group).
    private var fieldSections: [(section: String?, fields: [ReportFieldDefinition])] {
        let grouped = Dictionary(grouping: sortedFields) { $0.section }
        // Preserve order: nil section first, then named sections in field order
        var result: [(section: String?, fields: [ReportFieldDefinition])] = []
        if let defaultFields = grouped[nil], !defaultFields.isEmpty {
            result.append((section: nil, fields: defaultFields))
        }
        let namedSections = grouped.filter { $0.key != nil }
            .sorted { ($0.value.first?.order ?? 0) < ($1.value.first?.order ?? 0) }
        for (section, fields) in namedSections {
            result.append((section: section, fields: fields))
        }
        return result
    }

    var body: some View {
        NavigationStack {
            Form {
                ForEach(Array(fieldSections.enumerated()), id: \.offset) { _, group in
                    Section {
                        ForEach(group.fields) { field in
                            fieldInput(for: field)
                        }
                    } header: {
                        if let section = group.section {
                            Text(section)
                                .font(.brand(.headline))
                                .foregroundStyle(Color.brandForeground)
                        }
                    }
                }

                // Error display
                if let error = errorMessage {
                    Section {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(Color.brandDestructive)
                            Text(error)
                                .font(.brand(.footnote))
                                .foregroundStyle(Color.brandDestructive)
                        }
                    }
                    .accessibilityIdentifier("typed-report-error")
                }
            }
            .tint(Color.brandPrimary)
            .navigationTitle(reportType.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(NSLocalizedString("cancel", comment: "Cancel")) {
                        dismiss()
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("cancel-typed-report")
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submitReport() }
                    } label: {
                        Text(NSLocalizedString("report_submit", comment: "Submit"))
                            .font(.brand(.subheadline))
                            .fontWeight(.semibold)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 14)
                                    .fill(Color.brandPrimary)
                                    .opacity(isFormValid && !isSaving ? 1.0 : 0.4)
                            )
                    }
                    .disabled(!isFormValid || isSaving)
                    .accessibilityIdentifier("typed-report-submit")
                }
            }
            .loadingOverlay(
                isPresented: isSaving,
                message: NSLocalizedString("report_create_saving", comment: "Encrypting & submitting...")
            )
            .interactiveDismissDisabled(isSaving)
        }
    }

    // MARK: - Validation

    private var isFormValid: Bool {
        for field in sortedFields where field.required {
            switch field.fieldType {
            case .multiselect:
                if multiselectValues[field.name]?.isEmpty ?? true {
                    return false
                }
            case .date:
                if dateValues[field.name] == nil {
                    return false
                }
            default:
                if fieldValues[field.name] == nil {
                    return false
                }
            }
        }
        return true
    }

    // MARK: - Field Rendering

    @ViewBuilder
    private func fieldInput(for field: ReportFieldDefinition) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            switch field.fieldType {
            case .text:
                textField(for: field)

            case .textarea:
                textareaField(for: field)

            case .number:
                numberField(for: field)

            case .select:
                selectField(for: field)

            case .multiselect:
                multiselectField(for: field)

            case .checkbox:
                checkboxField(for: field)

            case .date:
                dateField(for: field)

            case .file:
                // File fields shown as placeholder — full media attach is a future epic
                fileFieldPlaceholder(for: field)
            }

            // Help text
            if let helpText = field.helpText, !helpText.isEmpty {
                Text(helpText)
                    .font(.brand(.caption))
                    .foregroundStyle(Color.brandMutedForeground)
            }

            // Required indicator
            if field.required {
                let hasValue: Bool = {
                    switch field.fieldType {
                    case .multiselect:
                        return !(multiselectValues[field.name]?.isEmpty ?? true)
                    case .date:
                        return dateValues[field.name] != nil
                    default:
                        return fieldValues[field.name] != nil
                    }
                }()
                if !hasValue {
                    Text(NSLocalizedString("field_required", comment: "Required"))
                        .font(.brand(.caption2))
                        .foregroundStyle(Color.brandDestructive)
                }
            }
        }
        .accessibilityIdentifier("field-\(field.name)")
    }

    // MARK: - Text Field

    @ViewBuilder
    private func textField(for field: ReportFieldDefinition) -> some View {
        TextField(field.label, text: textBinding(for: field.name))
            .font(.brand(.body))
    }

    // MARK: - Textarea Field

    @ViewBuilder
    private func textareaField(for field: ReportFieldDefinition) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(field.label)
                    .font(.brand(.subheadline))
                    .foregroundStyle(.secondary)

                if field.required {
                    Text("*")
                        .foregroundStyle(Color.brandDestructive)
                }

                Spacer()

                // Audio input button for fields that support it
                if field.supportAudioInput {
                    AudioInputButton(text: textBinding(for: field.name))
                }
            }

            TextEditor(text: textBinding(for: field.name))
                .frame(minHeight: 100)
                .font(.brand(.body))
                .foregroundStyle(Color.brandForeground)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Color.brandCard)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(
                            textBinding(for: field.name).wrappedValue.isEmpty
                                ? Color.brandBorder
                                : Color.brandPrimary.opacity(0.5),
                            lineWidth: 1
                        )
                )
        }
    }

    // MARK: - Number Field

    @ViewBuilder
    private func numberField(for field: ReportFieldDefinition) -> some View {
        HStack {
            Text(field.label)
                .font(.brand(.body))

            if field.required {
                Text("*")
                    .foregroundStyle(Color.brandDestructive)
            }

            Spacer()

            TextField("0", text: numberBinding(for: field.name))
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .font(.brand(.body))
                .frame(width: 80)
        }
    }

    // MARK: - Select Field

    @ViewBuilder
    private func selectField(for field: ReportFieldDefinition) -> some View {
        Picker(selection: selectBinding(for: field.name)) {
            Text(NSLocalizedString("select_placeholder", comment: "Select..."))
                .tag("")
            if let options = field.options {
                ForEach(options, id: \.key) { option in
                    Text(option.label).tag(option.key)
                }
            }
        } label: {
            HStack(spacing: 2) {
                Text(field.label)
                if field.required {
                    Text("*")
                        .foregroundStyle(Color.brandDestructive)
                }
            }
        }
        .font(.brand(.body))
    }

    // MARK: - Multiselect Field

    @ViewBuilder
    private func multiselectField(for field: ReportFieldDefinition) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 2) {
                Text(field.label)
                    .font(.brand(.subheadline))
                    .foregroundStyle(.secondary)
                if field.required {
                    Text("*")
                        .foregroundStyle(Color.brandDestructive)
                }
            }

            if let options = field.options {
                ForEach(options, id: \.key) { option in
                    Toggle(option.label, isOn: multiselectToggleBinding(for: field.name, key: option.key))
                        .font(.brand(.body))
                        .accessibilityIdentifier("field-\(field.name)-\(option.key)")
                }
            }
        }
    }

    // MARK: - Checkbox Field

    @ViewBuilder
    private func checkboxField(for field: ReportFieldDefinition) -> some View {
        Toggle(field.label, isOn: checkboxBinding(for: field.name))
            .font(.brand(.body))
    }

    // MARK: - Date Field

    @ViewBuilder
    private func dateField(for field: ReportFieldDefinition) -> some View {
        DatePicker(
            selection: dateBinding(for: field.name),
            displayedComponents: [.date, .hourAndMinute]
        ) {
            HStack(spacing: 2) {
                Text(field.label)
                    .font(.brand(.body))
                if field.required {
                    Text("*")
                        .foregroundStyle(Color.brandDestructive)
                }
            }
        }
    }

    // MARK: - File Placeholder

    @ViewBuilder
    private func fileFieldPlaceholder(for field: ReportFieldDefinition) -> some View {
        HStack {
            Image(systemName: "paperclip")
                .foregroundStyle(Color.brandMutedForeground)
            Text(field.label)
                .font(.brand(.body))
                .foregroundStyle(Color.brandMutedForeground)
            Spacer()
            Text(NSLocalizedString("report_file_coming_soon", comment: "Coming soon"))
                .font(.brand(.caption))
                .foregroundStyle(Color.brandMutedForeground)
        }
    }

    // MARK: - Field Bindings

    private func textBinding(for name: String) -> Binding<String> {
        Binding<String>(
            get: {
                if case .string(let val) = fieldValues[name] {
                    return val
                }
                return ""
            },
            set: { newValue in
                if newValue.isEmpty {
                    fieldValues.removeValue(forKey: name)
                } else {
                    fieldValues[name] = .string(newValue)
                }
            }
        )
    }

    private func numberBinding(for name: String) -> Binding<String> {
        Binding<String>(
            get: {
                if case .int(let val) = fieldValues[name] {
                    return "\(val)"
                }
                return ""
            },
            set: { newValue in
                if let intVal = Int(newValue) {
                    fieldValues[name] = .int(intVal)
                } else if newValue.isEmpty {
                    fieldValues.removeValue(forKey: name)
                }
            }
        )
    }

    private func selectBinding(for name: String) -> Binding<String> {
        Binding<String>(
            get: {
                if case .string(let val) = fieldValues[name] {
                    return val
                }
                return ""
            },
            set: { newValue in
                if newValue.isEmpty {
                    fieldValues.removeValue(forKey: name)
                } else {
                    fieldValues[name] = .string(newValue)
                }
            }
        )
    }

    private func checkboxBinding(for name: String) -> Binding<Bool> {
        Binding<Bool>(
            get: {
                if case .bool(let val) = fieldValues[name] {
                    return val
                }
                return false
            },
            set: { newValue in
                fieldValues[name] = .bool(newValue)
            }
        )
    }

    private func multiselectToggleBinding(for name: String, key: String) -> Binding<Bool> {
        Binding<Bool>(
            get: {
                multiselectValues[name]?.contains(key) ?? false
            },
            set: { isOn in
                var current = multiselectValues[name] ?? Set<String>()
                if isOn {
                    current.insert(key)
                } else {
                    current.remove(key)
                }
                multiselectValues[name] = current

                // Sync to fieldValues as comma-separated string
                if current.isEmpty {
                    fieldValues.removeValue(forKey: name)
                } else {
                    fieldValues[name] = .string(current.sorted().joined(separator: ","))
                }
            }
        )
    }

    private func dateBinding(for name: String) -> Binding<Date> {
        Binding<Date>(
            get: {
                dateValues[name] ?? Date()
            },
            set: { newValue in
                dateValues[name] = newValue
                // Store as ISO 8601 string
                let formatter = ISO8601DateFormatter()
                fieldValues[name] = .string(formatter.string(from: newValue))
            }
        )
    }

    // MARK: - Submit

    private func submitReport() async {
        // Validate required fields
        for field in sortedFields where field.required {
            let hasValue: Bool
            switch field.fieldType {
            case .multiselect:
                hasValue = !(multiselectValues[field.name]?.isEmpty ?? true)
            case .date:
                hasValue = dateValues[field.name] != nil
            default:
                hasValue = fieldValues[field.name] != nil
            }

            if !hasValue {
                errorMessage = String(
                    format: NSLocalizedString("note_create_field_required", comment: "%@ is required"),
                    field.label
                )
                return
            }
        }

        isSaving = true
        errorMessage = nil

        // Derive title from first text/textarea field or report type label
        let title = deriveTitle()

        let success = await onSubmit(title, fieldValues)

        if success {
            dismiss()
        } else {
            isSaving = false
        }
    }

    /// Derive a title from the first text or textarea field value, or fall back to
    /// the report type label with a timestamp.
    private func deriveTitle() -> String {
        // Try first text/textarea field as title
        for field in sortedFields {
            if field.fieldType == .text || field.fieldType == .textarea {
                if case .string(let val) = fieldValues[field.name], !val.isEmpty {
                    let trimmed = val.trimmingCharacters(in: .whitespacesAndNewlines)
                    // Use first 100 chars as title
                    if trimmed.count > 100 {
                        return String(trimmed.prefix(100))
                    }
                    return trimmed
                }
            }
        }

        // Fallback: report type label + date
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return "\(reportType.label) - \(formatter.string(from: Date()))"
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Typed Report Form") {
    TypedReportCreateView(
        reportType: ReportTypeDefinition(
            id: "1", name: "arrest_report", label: "Arrest Report",
            labelPlural: "Arrest Reports",
            description: "Document an arrest observed in the field",
            icon: "exclamationmark.shield.fill", color: "#E74C3C",
            category: "report",
            fields: [
                ReportFieldDefinition(
                    id: "f1", name: "location", label: "Location",
                    type: "text", required: true, options: nil,
                    section: nil, helpText: "Street address or intersection",
                    order: 0, accessLevel: "all", supportAudioInput: false
                ),
                ReportFieldDefinition(
                    id: "f2", name: "description", label: "Description",
                    type: "textarea", required: true, options: nil,
                    section: nil, helpText: "Describe what you observed",
                    order: 1, accessLevel: "all", supportAudioInput: true
                ),
                ReportFieldDefinition(
                    id: "f3", name: "num_arrested", label: "Number Arrested",
                    type: "number", required: false, options: nil,
                    section: "Details", helpText: nil,
                    order: 2, accessLevel: "all", supportAudioInput: false
                ),
                ReportFieldDefinition(
                    id: "f4", name: "arrest_type", label: "Arrest Type",
                    type: "select", required: true,
                    options: [
                        FieldOption(key: "mass", label: "Mass Arrest"),
                        FieldOption(key: "targeted", label: "Targeted"),
                        FieldOption(key: "unknown", label: "Unknown"),
                    ],
                    section: "Details", helpText: nil,
                    order: 3, accessLevel: "all", supportAudioInput: false
                ),
                ReportFieldDefinition(
                    id: "f5", name: "force_used", label: "Force Used",
                    type: "checkbox", required: false, options: nil,
                    section: "Details", helpText: nil,
                    order: 4, accessLevel: "all", supportAudioInput: false
                ),
                ReportFieldDefinition(
                    id: "f6", name: "charges", label: "Charges",
                    type: "multiselect", required: false,
                    options: [
                        FieldOption(key: "trespass", label: "Trespass"),
                        FieldOption(key: "disorderly", label: "Disorderly Conduct"),
                        FieldOption(key: "resisting", label: "Resisting Arrest"),
                        FieldOption(key: "other", label: "Other"),
                    ],
                    section: "Details", helpText: nil,
                    order: 5, accessLevel: "all", supportAudioInput: false
                ),
                ReportFieldDefinition(
                    id: "f7", name: "arrest_time", label: "Time of Arrest",
                    type: "date", required: false, options: nil,
                    section: "Details", helpText: nil,
                    order: 6, accessLevel: "all", supportAudioInput: false
                ),
            ],
            statuses: [StatusOption(value: "open", label: "Open", color: nil, order: 0, isClosed: nil)],
            defaultStatus: "open",
            allowFileAttachments: true, allowCaseConversion: true,
            mobileOptimized: true, isArchived: false
        ),
        onSubmit: { _, _ in true }
    )
}
#endif
