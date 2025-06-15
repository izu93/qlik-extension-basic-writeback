export default function ext() {
  return {
    definition: {
      type: "items",
      component: "accordion",
      items: {
        data: { uses: "data" },
        settings: { uses: "settings" },
      },
    },
    support: { snapshot: true, export: true, exportData: true },
  };
}
