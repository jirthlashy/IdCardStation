import { registerDemoCommands } from "./demo/demoCommands.js";
import { readerConfig } from "./config/config.js";
import { startKafka } from "./infra/kafka.js";
import { startSmartCardReader } from "./reader/smartCardReader.js";

await startKafka();
await startSmartCardReader();
if (readerConfig.enableDemoCommands) {
  registerDemoCommands();
}
