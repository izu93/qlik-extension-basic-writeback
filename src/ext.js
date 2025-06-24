export default function ext(galaxy) {
  return {
    definition: {
      type: "items",
      component: "accordion",
      items: {
        data: {
          uses: "data",
        },
        sorting: {
          uses: "sorting",
        },
        keyDimensions: {
          type: "items",
          label: "Key Dimensions",
          items: {
            keyDimensionInfo: {
              component: "text",
              label: "Information",
              style: "hint",
              defaultValue:
                "Mark dimensions as key dimensions to create unique identifiers for writeback operations. Multiple key dimensions will be combined to form a composite key.",
            },
            keyDimensions: {
              type: "array",
              label: "Key Dimension Configuration",
              ref: "keyDimensions",
              itemTitleRef: function (data) {
                return data.dimensionName || "New Key Dimension";
              },
              allowAdd: true,
              allowRemove: true,
              allowMove: true,
              addTranslation: "Add Key Dimension",
              items: {
                dimensionName: {
                  type: "string",
                  label: "Dimension Name",
                  ref: "dimensionName",
                  expression: "optional",
                  defaultValue: "",
                  placeholder: "Enter dimension name (e.g., CUSTOMER_ID, DATE)",
                },
                isKeyDimension: {
                  type: "boolean",
                  label: "Key Dimension",
                  ref: "isKeyDimension",
                  defaultValue: true,
                },
                keyOrder: {
                  type: "number",
                  label: "Key Order (1, 2, 3...)",
                  ref: "keyOrder",
                  defaultValue: 1,
                  show: function (data) {
                    return data.isKeyDimension;
                  },
                },
                description: {
                  type: "string",
                  label: "Description",
                  ref: "description",
                  defaultValue: "",
                  placeholder: "Describe this key dimension...",
                },
              },
            },
            keyDimensionSettings: {
              type: "items",
              label: "Key Settings",
              show: function (data) {
                return data.keyDimensions && data.keyDimensions.length > 0;
              },
              items: {
                keyGenerationStrategy: {
                  type: "string",
                  label: "Key Generation Strategy",
                  ref: "keyGenerationStrategy",
                  component: "dropdown",
                  options: [
                    {
                      value: "concatenate",
                      label: "Concatenate with Separator",
                    },
                    { value: "hash", label: "Generate Hash from Keys" },
                    { value: "composite", label: "Keep as Composite Object" },
                  ],
                  defaultValue: "concatenate",
                },
                keySeparator: {
                  type: "string",
                  label: "Key Separator",
                  ref: "keySeparator",
                  defaultValue: "|",
                  show: function (data) {
                    return data.keyGenerationStrategy === "concatenate";
                  },
                },
                showKeyInTable: {
                  type: "boolean",
                  label: "Show Generated Key in Table",
                  ref: "showKeyInTable",
                  defaultValue: false,
                },
                validateKeyUniqueness: {
                  type: "boolean",
                  label: "Validate Key Uniqueness",
                  ref: "validateKeyUniqueness",
                  defaultValue: true,
                },
              },
            },
          },
        },
        writeback: {
          type: "items",
          label: "Writeback Configuration",
          items: {
            writebackEnabled: {
              type: "boolean",
              label: "Enable Writeback",
              ref: "writebackConfig.enabled",
              defaultValue: false,
            },
            writebackInfo: {
              component: "text",
              label: "Information",
              style: "hint",
              defaultValue:
                "Add writeback columns below, then add those column names as dimensions in your data model to enable editing.",
              show: function (data) {
                return data.writebackConfig && data.writebackConfig.enabled;
              },
            },
            writebackColumns: {
              type: "array",
              label: "Writeback Columns",
              ref: "writebackConfig.columns",
              itemTitleRef: "columnName",
              allowAdd: true,
              allowRemove: true,
              allowMove: true,
              addTranslation: "Add Writeback Column",
              show: function (data) {
                return data.writebackConfig && data.writebackConfig.enabled;
              },
              items: {
                columnName: {
                  type: "string",
                  label: "Column Name",
                  ref: "columnName",
                  expression: "optional",
                  defaultValue: "",
                  placeholder: "Enter column name (e.g., NOTES, STATUS)",
                },
                columnType: {
                  type: "string",
                  label: "Input Type",
                  ref: "columnType",
                  component: "dropdown",
                  options: [
                    { value: "text", label: "Text Input" },
                    { value: "textarea", label: "Text Area" },
                    { value: "number", label: "Number Input" },
                    { value: "dropdown", label: "Dropdown" },
                    { value: "date", label: "Date Input" },
                    { value: "checkbox", label: "Checkbox" },
                  ],
                  defaultValue: "text",
                },
                placeholder: {
                  type: "string",
                  label: "Placeholder Text",
                  ref: "placeholder",
                  defaultValue: "Enter value...",
                  show: function (data) {
                    return data.columnType !== "checkbox";
                  },
                },
                defaultValue: {
                  type: "string",
                  label: "Default Value",
                  ref: "defaultValue",
                  defaultValue: "",
                },
                readOnly: {
                  type: "boolean",
                  label: "Read Only",
                  ref: "readOnly",
                  defaultValue: false,
                },
                required: {
                  type: "boolean",
                  label: "Required Field",
                  ref: "required",
                  defaultValue: false,
                },
                width: {
                  type: "string",
                  label: "Column Width (px)",
                  ref: "width",
                  defaultValue: "150px",
                },
                dropdownOptions: {
                  type: "string",
                  label: "Dropdown Options (comma separated)",
                  ref: "dropdownOptions",
                  defaultValue: "Option 1,Option 2,Option 3",
                  show: function (data) {
                    return data.columnType === "dropdown";
                  },
                },
                validation: {
                  type: "items",
                  label: "Validation",
                  items: {
                    minLength: {
                      type: "number",
                      label: "Minimum Length",
                      ref: "validation.minLength",
                      defaultValue: 0,
                      show: function (data) {
                        return (
                          data.columnType === "text" ||
                          data.columnType === "textarea"
                        );
                      },
                    },
                    maxLength: {
                      type: "number",
                      label: "Maximum Length",
                      ref: "validation.maxLength",
                      defaultValue: 255,
                      show: function (data) {
                        return (
                          data.columnType === "text" ||
                          data.columnType === "textarea"
                        );
                      },
                    },
                    min: {
                      type: "number",
                      label: "Minimum Value",
                      ref: "validation.min",
                      show: function (data) {
                        return data.columnType === "number";
                      },
                    },
                    max: {
                      type: "number",
                      label: "Maximum Value",
                      ref: "validation.max",
                      show: function (data) {
                        return data.columnType === "number";
                      },
                    },
                  },
                },
              },
            },
            globalSettings: {
              type: "items",
              label: "Global Writeback Settings",
              show: function (data) {
                return (
                  data.writebackConfig &&
                  data.writebackConfig.enabled &&
                  data.writebackConfig.columns &&
                  data.writebackConfig.columns.length > 0
                );
              },
              items: {
                saveMode: {
                  type: "string",
                  label: "Save Mode",
                  ref: "writebackConfig.saveMode",
                  component: "dropdown",
                  options: [
                    { value: "manual", label: "Manual Save (Button Click)" },
                    { value: "auto", label: "Auto Save (On Change)" },
                    { value: "batch", label: "Batch Save (Timed)" },
                  ],
                  defaultValue: "manual",
                },
                autoSaveDelay: {
                  type: "number",
                  label: "Auto Save Delay (seconds)",
                  ref: "writebackConfig.autoSaveDelay",
                  defaultValue: 2,
                  show: function (data) {
                    return (
                      data.writebackConfig &&
                      data.writebackConfig.saveMode === "auto"
                    );
                  },
                },
                batchSaveInterval: {
                  type: "number",
                  label: "Batch Save Interval (minutes)",
                  ref: "writebackConfig.batchSaveInterval",
                  defaultValue: 5,
                  show: function (data) {
                    return (
                      data.writebackConfig &&
                      data.writebackConfig.saveMode === "batch"
                    );
                  },
                },
                showChangeCounter: {
                  type: "boolean",
                  label: "Show Change Counter",
                  ref: "writebackConfig.showChangeCounter",
                  defaultValue: true,
                },
                confirmBeforeSave: {
                  type: "boolean",
                  label: "Confirm Before Save",
                  ref: "writebackConfig.confirmBeforeSave",
                  defaultValue: false,
                },
              },
            },
          },
        },
        settings: {
          uses: "settings",
        },
      },
    },
    support: {
      snapshot: true,
      export: true,
      exportData: true,
    },
  };
}
