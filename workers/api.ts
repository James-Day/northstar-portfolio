import { api, type ApiBindings } from '@/services/api/app';

export default {
  fetch(request: Request, environment: ApiBindings, executionContext: ExecutionContext) {
    return api.fetch(request, environment, executionContext);
  },
};
