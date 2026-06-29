/**
 * Zod validation middleware. Parses the chosen request part and replaces it with
 * the parsed/typed value. ZodError flows to the global error handler → 422.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    try {
      req[source] = schema.parse(req[source]);
      next();
    } catch (err) {
      next(err);
    }
  };
}
