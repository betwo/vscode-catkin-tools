import { run_integration_tests } from "./integration/integration_test";
import { run_unit_tests } from "./unit/unit_test";

async function run() {
    await run_unit_tests();
    await run_integration_tests();
}

run ();