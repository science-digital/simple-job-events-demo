"""
Workflow Simulator Engine

Loads preset workflow definitions and executes them, emitting IVCAP events
with randomized timing to simulate multi-agent workflows.
"""

import json
import random
import time
from pathlib import Path
from dataclasses import dataclass
from contextlib import contextmanager
from typing import Callable, Iterator

from pydantic import BaseModel, Field
from ivcap_ai_tool.executor import JobContext
from ivcap_service import getLogger


class AgentConfig(BaseModel):
    """Configuration for a single agent within a phase."""
    id: str = Field(description="Unique identifier for the agent")
    name: str = Field(description="Display name of the agent")
    tasks: list[str] = Field(description="List of task status messages to emit")
    delay_range_ms: list[int] = Field(
        default=[1000, 3000],
        description="Min/max delay in ms between task updates"
    )


class PhaseConfig(BaseModel):
    """Configuration for a workflow phase."""
    id: str = Field(description="Unique identifier for the phase")
    name: str = Field(description="Display name of the phase")
    delay_range_ms: list[int] = Field(
        default=[500, 2000],
        description="Min/max delay in ms for phase transitions"
    )
    agents: list[AgentConfig] = Field(
        default_factory=list,
        description="Agents that execute within this phase"
    )


class WorkflowPreset(BaseModel):
    """Complete workflow preset definition."""
    name: str = Field(description="Name of the workflow preset")
    description: str = Field(description="Description of what this workflow simulates")
    phases: list[PhaseConfig] = Field(description="Ordered list of workflow phases")


@dataclass
class SimulationResult:
    """Result of running a workflow simulation."""
    preset_name: str
    phases_completed: int
    agents_executed: int
    total_events: int
    elapsed_seconds: float


class WorkflowSimulator:
    """
    Executes workflow simulations based on preset definitions,
    emitting IVCAP events with realistic timing.
    """
    
    MAX_TIMER_SECONDS = 600
    PRESETS_DIR = Path(__file__).parent / "presets"
    
    def __init__(
        self,
        job_context: JobContext,
        logger=None,
    ):
        """
        Initialize the simulator.
        
        Args:
            job_context: IVCAP JobContext for emitting events
        """
        self.job_context = job_context
        self._event_count = 0
        self._agents_executed = 0
        self.logger = logger or getLogger("simulator")
    
    def load_preset(self, preset_name: str) -> WorkflowPreset:
        """
        Load a workflow preset from the presets directory.
        
        Args:
            preset_name: Name of the preset (without .json extension)
            
        Returns:
            WorkflowPreset configuration
            
        Raises:
            FileNotFoundError: If preset doesn't exist
            ValueError: If preset is invalid
        """
        preset_path = self.PRESETS_DIR / f"{preset_name}.json"
        
        if not preset_path.exists():
            available = [p.stem for p in self.PRESETS_DIR.glob("*.json")]
            raise FileNotFoundError(
                f"Preset '{preset_name}' not found. Available presets: {available}"
            )
        
        with open(preset_path) as f:
            data = json.load(f)
        
        return WorkflowPreset(**data)
    
    def list_presets(self) -> list[str]:
        """Return list of available preset names."""
        if not self.PRESETS_DIR.exists():
            return []
        return [p.stem for p in self.PRESETS_DIR.glob("*.json")]
    
    def _random_delay(self, delay_range_ms: list[int]) -> None:
        """Sleep for a random duration within the given range."""
        min_ms, max_ms = delay_range_ms
        delay_ms = random.randint(min_ms, max_ms)
        time.sleep(delay_ms / 1000.0)

    def _annotate_message(self, message: str, emit_path: str) -> str:
        """Attach emitter info to messages for visibility."""
        marker = " [emit="
        if marker in message:
            return message
        return f"{message}{marker}{emit_path}]"
    
    @contextmanager
    def _report_step(
        self,
        step_id: str,
        start_message: str,
    ) -> Iterator[Callable[[str], None]]:
        """Emit a start/finish step event with compatibility fallbacks."""
        reporter = self.job_context.report
        start_emit_path = "noop"
        if reporter is not None and hasattr(reporter, "step"):
            start_emit_path = "report.step"
        elif reporter is not None and hasattr(reporter, "step_started"):
            start_emit_path = "step_started"

        start_message = self._annotate_message(start_message, start_emit_path)
        self._event_count += 1
        self.logger.info(
            "Emitting step_started via %s for %s: %s",
            start_emit_path,
            step_id,
            start_message,
        )

        finished = False
        step = None

        def finish(message: str) -> None:
            nonlocal finished
            if finished:
                return
            finished = True
            finish_emit_path = "noop"
            if step is not None and hasattr(step, "finished"):
                finish_emit_path = "report.step"
            elif reporter is not None and hasattr(reporter, "step_finished"):
                finish_emit_path = "step_finished"

            message = self._annotate_message(message, finish_emit_path)
            self._event_count += 1
            self.logger.info(
                "Emitting step_finished via %s for %s: %s",
                finish_emit_path,
                step_id,
                message,
            )
            if reporter is None:
                return
            if step is not None and hasattr(step, "finished"):
                step.finished(message)
            elif hasattr(reporter, "step_finished"):
                reporter.step_finished(
                    step_id,
                    raw_event={
                        "message": message,
                        "emit": finish_emit_path,
                    },
                )

        if reporter is not None and hasattr(reporter, "step"):
            with reporter.step(step_id, start_message) as step:
                try:
                    yield finish
                finally:
                    if not finished:
                        finish(start_message)
            return

        if reporter is not None and hasattr(reporter, "step_started"):
            reporter.step_started(
                step_id,
                raw_event={
                    "message": start_message,
                    "emit": start_emit_path,
                },
            )

        try:
            yield finish
        finally:
            if not finished:
                finish(start_message)

    def _emit_tick(self, step_id: str, message: str) -> None:
        """Emit a single 'tick' event (start-only)."""
        reporter = self.job_context.report
        emit_path = "noop"
        if reporter is not None and hasattr(reporter, "step_started"):
            emit_path = "step_started"
        elif reporter is not None and hasattr(reporter, "step"):
            emit_path = "report.step"

        message = self._annotate_message(message, emit_path)
        self._event_count += 1
        self.logger.info(
            "Emitting step_started via %s for %s: %s",
            emit_path,
            step_id,
            message,
        )
        if reporter is None:
            return
        if hasattr(reporter, "step_started"):
            reporter.step_started(
                step_id,
                raw_event={
                    "message": message,
                    "emit": emit_path,
                },
            )
            return
        if hasattr(reporter, "step"):
            with reporter.step(step_id, message) as step:
                pass
    
    def _execute_agent(self, phase_id: str, agent: AgentConfig) -> None:
        """Execute a single agent's tasks within a phase."""
        agent_step_id = f"agent:{phase_id}:{agent.id}"

        with self._report_step(agent_step_id, f"{agent.name} started") as finish:
            # Execute each task
            for i, task in enumerate(agent.tasks):
                status_step_id = f"{agent_step_id}:task-{i+1}"
                with self._report_step(status_step_id, task) as finish_task:
                    self._random_delay(agent.delay_range_ms)
                    finish_task(task)

            # Agent completed
            self._random_delay(agent.delay_range_ms)
            finish(f"{agent.name} completed")
        self._agents_executed += 1
    
    def _execute_phase(self, phase: PhaseConfig) -> None:
        """Execute a single workflow phase and all its agents."""
        phase_step_id = f"phase:{phase.id}"

        with self._report_step(phase_step_id, f"{phase.name} started") as finish:
            self._random_delay(phase.delay_range_ms)

            # Execute all agents in the phase
            for agent in phase.agents:
                self._execute_agent(phase.id, agent)

            # Phase completed
            self._random_delay(phase.delay_range_ms)
            finish(f"{phase.name} completed")
    
    def run(self, preset_name: str) -> SimulationResult:
        """
        Run a complete workflow simulation.
        
        Args:
            preset_name: Name of the preset to run
            
        Returns:
            SimulationResult with execution statistics
        """
        start_time = time.time()
        self._event_count = 0
        self._agents_executed = 0
        
        # Load and validate preset
        preset = self.load_preset(preset_name)
        
        # Emit workflow start
        workflow_step_id = f"workflow:{preset.name}"
        elapsed = 0.0
        with self._report_step(
            workflow_step_id,
            f"Starting workflow: {preset.description}",
        ) as finish:
            # Execute all phases in order
            for phase in preset.phases:
                self._execute_phase(phase)

            # Emit workflow completion
            elapsed = time.time() - start_time
            finish(f"Workflow completed in {elapsed:.1f}s")
        
        return SimulationResult(
            preset_name=preset.name,
            phases_completed=len(preset.phases),
            agents_executed=self._agents_executed,
            total_events=self._event_count,
            elapsed_seconds=elapsed
        )

    def run_timer_tick(
        self,
        total_run_time_seconds: float,
        tick_interval_seconds: float,
    ) -> SimulationResult:
        """
        Run a simple timer/tick simulation for a fixed duration.

        Emits one event per tick interval using step_started only.
        """
        start_time = time.time()
        self._event_count = 0
        self._agents_executed = 0

        end_time = start_time + total_run_time_seconds
        tick_index = 0

        while time.time() < end_time:
            tick_index += 1
            step_id = f"timer:tick:{tick_index}"
            self._emit_tick(step_id, f"Tick {tick_index}")

            remaining = end_time - time.time()
            if remaining <= 0:
                break
            time.sleep(min(tick_interval_seconds, remaining))

        elapsed = time.time() - start_time
        return SimulationResult(
            preset_name="timer_tick",
            phases_completed=0,
            agents_executed=0,
            total_events=self._event_count,
            elapsed_seconds=elapsed,
        )
