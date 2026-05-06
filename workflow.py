from render_sdk import Workflows, Retry

app = Workflows()

@app.task
def clone_and_setup() -> dict:
    """Clone the repo and prepare the environment"""
    import subprocess
    import os
    
    # Clone the repository
    subprocess.run([
        "git", "clone", 
        "https://github.com/benbenido025-lab/Hello-kutty"
    ], check=True)
    
    # Change to the repo directory
    repo_path = os.path.join(os.getcwd(), "Hello-kutty")
    
    return {
        "repo_path": repo_path,
        "status": "cloned"
    }

@app.task(
    name="run_node_app",
    retry=Retry(max_retries=3, wait_duration_ms=1000, backoff_scaling=1.5),
    timeout_seconds=300,
    plan="standard",
)
def run_node_app(setup_result: dict):
    """Run the Node.js application"""
    import subprocess
    import os
    
    repo_path = setup_result["repo_path"]
    
    # Change to the repo directory and run node
    result = subprocess.run(
        ["node", "index.js"],
        cwd=repo_path,
        capture_output=True,
        text=True,
        check=True
    )
    
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "status": "completed"
    }

@app.task
def workflow_orchestrator():
    """Orchestrate the full workflow"""
    setup = clone_and_setup()
    result = run_node_app(setup)
    return result

if __name__ == "__main__":
    app.start()
