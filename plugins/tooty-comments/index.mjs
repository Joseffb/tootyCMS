export async function register(kernel, api) {
  if (api?.registerCommentProvider && api?.core?.comments?.createTableBackedProvider) {
    api.registerCommentProvider(
      api.core.comments.createTableBackedProvider({
        id: "tooty-comments",
      }),
    );
  }
  kernel.enqueueScript({
    id: "tooty-comments-widget",
    src: "/plugin-assets/tooty-comments/comments-widget.js",
  });
}
