# Playwright Tests folder


This folder contain the playwright tests for this project. If you want to run tests, see [How to run tests](./Howto%20run%20tests.md), if you want to create tests, see below. 

For each card in /corp-src/cards there must be two .spec.ts files.
1. One (cardname).spec.ts file within /pwtests/corp-src/integration-tests that is an integrated test, testing against the actual backend systems.
1. One (cardname).spec.ts file within /pwtests/corp-src/mock-tests that is mocking the backend systems APIs, e.g. keeping all local browser capability, but removing cross network traffic.

Note: Folder paths are expressed from the root of this Node workspace.

When creating tests, always first create the integration test first and verify every step individually with a product owner.
Once the integration test correctly captures the business requirements then the mock test can be created from that.
Always ensure the mock test is in alignment with the integration test for that card, so that changes to the integration test is transfered to the mock test.

When reviewing and changing tests, work on one card at a time, completing the integration test and mock test before doing another card, under guidenance from the product owner.

## Authenticated Session State
Session state is only needed for integration tests, not mock tests. 
It's recommended to refresh the session state for GitHub and Azure whenever starting a new session of work on integration tests.
The session state files are stored in /pwtests/corp-src/.auth can be refreshed by running the auth session state setup cards.

### To setup auth session state for cards that use Azure
Run the following test while showing the browser and letting the user authenticate: /pwtests/corp-src/setup/azure-login.setup.ts

### Setup auth session state for cards that use Github:
Ask the user if they want to use a PAT or backend. 

#### PAT path
If they want to use a PAT, they need to save the PAT into /.env as GITHUB_TOKEN
Then run the following test while showing the browser: /pwtests/corp-src/setup/github-pat-login.setup.ts

#### Backend path
Run the following test while showing the browser and letting the user authenticate: /pwtests/corp-src/setup/github-backend-login.setup.ts

## Notes to AI:
Refer to the AI agent guidance at [PlaywrightTest-developer.md](/agents/playwrightTest-developer.md)

