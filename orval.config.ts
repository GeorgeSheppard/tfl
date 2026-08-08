export default {
  api: {
    input: {
      target: './openapi.json',
    },
    output: {
      target: './src/api/generated.ts',
      client: 'fetch',
      mode: 'single',
      prettier: true,
      clean: true,
      mock: false,
      override: {
        mutator: {
          path: './src/lib/custom-fetch.ts',
          name: 'customFetch',
        },
        fetch: {
          includeHttpResponseReturnType: false,
        },
      },
    },
  },
};
