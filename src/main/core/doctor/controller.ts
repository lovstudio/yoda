import { createRPCController } from '@shared/ipc/rpc';
import { scanDoctor, scanDoctorWorkspace } from './doctor-service';

export const doctorController = createRPCController({
  scan: (args?: { refresh?: boolean }) => scanDoctor(args),
  scanWorkspace: (projectId: string) => scanDoctorWorkspace(projectId),
});
