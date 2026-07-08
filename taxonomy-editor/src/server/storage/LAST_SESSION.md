**Date:** 2026-07-06
**Working on:** t/1339 (optionality-aware 404 log level downgrade in GitHub API backend)
**Status:** Complete — committed 5ef24896, ticket Done
**Key context:** `optional?: boolean` added to StorageBackend.readFile opts; threaded through GitHubAPIBackend readFile→fetchFileFromGitHub→apiRequest; new EventType 'github.api.miss' in lib/flight-recorder/types.ts (cross-scope edit to Shared Lib)
**Next:** Check ticket queue for new assignments
