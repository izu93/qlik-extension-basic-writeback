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
