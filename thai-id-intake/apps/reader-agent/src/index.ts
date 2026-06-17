import { registerDemoCommands } from "./demo/demoCommands.js";
import { startKafka } from "./infra/kafka.js";
import { startSmartCardReader } from "./reader/smartCardReader.js";

await startKafka();
await startSmartCardReader();
registerDemoCommands();
