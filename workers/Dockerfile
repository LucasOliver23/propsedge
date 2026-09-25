FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV RUN_ALL_JOBS=1
CMD ["python", "run.py", "live"]
