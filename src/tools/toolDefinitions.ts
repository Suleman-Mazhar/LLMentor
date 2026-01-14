export const debuggerToolDefinition = {
    name: 'debugger',
    description: `Control the VS Code debugger to help the student understand their code execution step by step.

Available actions:
- start: Start debugging the current file (stops on first line)
- set_breakpoints: Set breakpoints at specific lines. Params: { file: string, lines: number[] }
- step_over: Execute current line and move to next (don't go into functions)
- step_into: Step into function calls
- step_out: Step out of current function
- continue: Continue execution until next breakpoint
- get_state: Get current debug state (location, variables, call stack)
- evaluate: Evaluate an expression. Params: { expression: string }
- stop: Stop the debug session

After each step action (step_over, step_into, step_out, continue), you'll receive the new state automatically.

Always explain what's happening at each step in educational terms before deciding on the next action.`,

    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: [
                    'start',
                    'set_breakpoints',
                    'step_over',
                    'step_into',
                    'step_out',
                    'continue',
                    'get_state',
                    'evaluate',
                    'stop'
                ],
                description: 'The debugger action to perform'
            },
            file: {
                type: 'string',
                description: 'File path (for set_breakpoints)'
            },
            lines: {
                type: 'array',
                items: { type: 'number' },
                description: 'Line numbers (for set_breakpoints)'
            },
            expression: {
                type: 'string',
                description: 'Expression to evaluate (for evaluate action)'
            }
        },
        required: ['action']
    }
};

export const WALKTHROUGH_SYSTEM_PROMPT = `You are LLMentor, an AI programming tutor guiding a student through their code using a debugger.

Your goal is to help the student understand HOW their code executes step by step.

You have access to a 'debugger' tool. Use it to:
1. First, analyze the code and set breakpoints at interesting/educational lines
2. Start the debugger
3. At each stop, explain what's happening:
   - What line are we on?
   - What does this line do?
   - What are the current variable values and why?
   - What will happen next?
4. Step through the code methodically
5. Point out important concepts (loops, conditionals, function calls, etc.)

Guidelines:
- Be encouraging and educational
- Explain in simple terms
- After explaining each step, use step_over for most lines
- Use step_into when entering a function would be educational
- Use continue to skip to the next breakpoint if a section is repetitive
- Keep explanations concise but clear
- Ask the student if they understand or have questions periodically
- When the program ends, provide a summary of what was learned

Start by analyzing the code and setting appropriate breakpoints, then begin the walkthrough.`;